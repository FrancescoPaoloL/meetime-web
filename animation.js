// Animation of the person view: where the person is at a given moment of the clock.
// The clock is a fractional year (1851.5 = the middle of 1851). Every function here is pure: the same clock gives the
// same position, so the time bar can later move backwards too.

// How long a trip between two stops takes, in years. Dates are years, so the trip is the end of the year before the
// next stop: a quarter of a year is visible on screen and short next to the stays.
const TRAVEL_YEARS = 0.25;
// A trip never takes more than this share of the time between two arrivals, so a short stop is not all travel.
const MAX_TRAVEL_SHARE = 0.5;
// How far the arc bends sideways, as a share of the straight distance (0 = straight line).
const ARC_BEND = 0.2;

// A calendar moment as a fractional year: the share of its year already gone (leap years included).
function fraction(year, milliseconds) {
  const start = Date.UTC(year, 0, 1);
  return year + (milliseconds - start) / (Date.UTC(year + 1, 0, 1) - start);
}

// "1851-07-02" -> the start of that day as a fractional year.
export function yearOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return fraction(year, Date.UTC(year, month - 1, day));
}

// "1851-12-31" -> the END of that day (the start of the next one): an inner_end is the last day the person was there.
export function endYearOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = Date.UTC(year, month - 1, day + 1);
  return fraction(new Date(next).getUTCFullYear(), next);
}

// The stops of one life in time order, {place, start, end} in fractional years. The same place twice in a row counts
// once (the same rule as the still track). The sort is stable, so stays starting together keep the API order (by name).
function stopsOf(stays) {
  const sorted = [...stays].sort((one, two) => one.inner_start.localeCompare(two.inner_start));
  const stops = [];
  for (const stay of sorted) {
    const start = yearOf(stay.inner_start);
    const end = endYearOf(stay.inner_end);
    const last = stops[stops.length - 1];
    if (last !== undefined && last.place === stay.place) {
      last.end = Math.max(last.end, end);
    } else {
      stops.push({ place: stay.place, start, end });
    }
  }
  return stops;
}

// The first moment a meeting at the place of `stop` begins inside the stop (its window overlaps the stop), Infinity if
// none: the key that orders the stops of a group.
function firstMeetingAt(stop, meetingsOfScene) {
  const starts = meetingsOfScene
    .filter((meeting) => meeting.place === stop.place && meeting.start < stop.end && meeting.end > stop.start)
    .map((meeting) => meeting.start);
  return Math.min(Infinity, ...starts);
}

// When the person arrives at each stop. Stops that start at the same moment (a tour: Verdi in 1875 is in several
// places within one year, and the dates are years) share their time in equal parts, from the common start to the
// first end of the group, or to the next start if that comes first.
// Inside a group the stop whose meeting begins first comes first, the stops with no meeting last: with the API order
// (by name) Agatha Christie was in Hampstead in 1941-1943 and reached London only after the window of her meeting there
// (Eisenhower, 1942), so it never came on screen. The sort is stable: stops with the same key keep the API order.
// Two meetings at different places in the same window can still clash: one of them may stay off screen.
// `meetingsOfScene` (see meetings below) may be left out: then the API order is kept.
// Returns {arrivals: [{place, arrive}], first, last}: first and last are the ends of the clock.
export function schedule(stays, meetingsOfScene = []) {
  const stops = stopsOf(stays);
  const arrivals = [];
  let index = 0;
  while (index < stops.length) {
    let after = index;
    while (after < stops.length && stops[after].start === stops[index].start) {
      after += 1;
    }
    const group = stops.slice(index, after);
    // Compared, not subtracted: Infinity - Infinity is NaN, which breaks the sort.
    const key = new Map(group.map((stop) => [stop, firstMeetingAt(stop, meetingsOfScene)]));
    group.sort((one, two) => (key.get(one) === key.get(two) ? 0 : key.get(one) < key.get(two) ? -1 : 1));
    let groupEnd = Math.min(...group.map((stop) => stop.end));
    if (after < stops.length) {
      groupEnd = Math.min(groupEnd, stops[after].start);
    }
    const share = (groupEnd - group[0].start) / group.length;
    group.forEach((stop, k) => arrivals.push({ place: stop.place, arrive: stop.start + k * share, end: stop.end }));
    index = after;
  }
  return { arrivals: withReturns(arrivals), first: stops[0].start, last: Math.max(...stops.map((stop) => stop.end)) };
}

// The returns to the base. The arrivals only go forward: after a short stop the person stayed there until the next
// arrival, even when a longer stay was still going on (Napoleon in Paris 1792-1814: after Sardinia 1793 he never came
// back, and the meetings in Paris of the next twenty years never came on screen, 7 of 26). Rule (2026-11-15): when a
// stop ends before the next arrival, the person goes back to the most recent earlier stop still open at that moment,
// the one it came from. No return to the place it is leaving, nor to the place of the next arrival (it goes there
// anyway). The `end` of each arrival is used here only and dropped from the result.
// Known side effect: the stops of a multi-place sentence (Mozart 1777-1779: Paris, Mannheim, Munich) all stay open,
// so a return can bring the person back to one of them and show a meeting the data got wrong.
function withReturns(arrivals) {
  const result = [];
  arrivals.forEach((arrival, index) => {
    result.push({ place: arrival.place, arrive: arrival.arrive });
    const next = arrivals[index + 1];
    const nextArrive = next === undefined ? Infinity : next.arrive;
    if (arrival.end >= nextArrive) {
      return;
    }
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const base = arrivals[earlier];
      if (base.end > arrival.end) {
        if (base.place !== arrival.place && base.place !== next?.place) {
          result.push({ place: base.place, arrive: arrival.end });
        }
        return;
      }
    }
  });
  return result;
}

// Smooth start and stop of a trip (smoothstep): progress 0..1 in, eased progress 0..1 out.
function ease(progress) {
  return progress * progress * (3 - 2 * progress);
}

// A point on the arc from one [lon, lat] to another: a quadratic Bezier whose control point is the midpoint pushed
// sideways by ARC_BEND times the distance. Going back bends to the other side, so two trips do not overlap.
function arcPoint([lon0, lat0], [lon1, lat1], progress) {
  const controlLon = (lon0 + lon1) / 2 - (lat1 - lat0) * ARC_BEND;
  const controlLat = (lat0 + lat1) / 2 + (lon1 - lon0) * ARC_BEND;
  const rest = 1 - progress;
  return [
    rest * rest * lon0 + 2 * rest * progress * controlLon + progress * progress * lon1,
    rest * rest * lat0 + 2 * rest * progress * controlLat + progress * progress * lat1,
  ];
}

// The leg of the life at `clock`: the arrival the person is at, the next one (null after the last), when the trip to
// it starts (`leave`) and how long it takes (`travel`, in years). Before the first arrival: the first leg.
function legAt(plan, clock) {
  const { arrivals } = plan;
  let index = 0;
  while (index + 1 < arrivals.length && arrivals[index + 1].arrive <= clock) {
    index += 1;
  }
  const here = arrivals[index];
  const next = arrivals[index + 1];
  if (next === undefined) {
    return { here, next: null, leave: Infinity, travel: 0 };
  }
  const travel = Math.min(TRAVEL_YEARS, MAX_TRAVEL_SHARE * (next.arrive - here.arrive));
  return { here, next, leave: next.arrive - travel, travel };
}

// The length in years of the trip in progress at `clock`, 0 when the person is still at a stop. The clock uses it to
// slow down during a trip, so every trip lasts the same on screen however short it is in years.
export function tripYearsAt(plan, clock) {
  const leg = legAt(plan, clock);
  return clock >= leg.leave ? leg.travel : 0;
}

// Where the person is at `clock`: still at a stop, or on the arc to the next one during the trip before it.
// `places` maps a place QID to its place (lon, lat). After the last arrival: at the last stop.
export function positionAt(plan, places, clock) {
  const leg = legAt(plan, clock);
  const here = places.get(leg.here.place);
  const herePoint = [here.lon, here.lat];
  if (clock < leg.leave) {
    return herePoint;
  }
  const there = places.get(leg.next.place);
  return arcPoint(herePoint, [there.lon, there.lat], ease((clock - leg.leave) / leg.travel));
}

// The share of a trip where the arc is farthest from the straight line: its middle (the control point of the curve
// sits sideways of the midpoint, see arcPoint).
const ARC_MIDDLE = 0.5;

// The trip in progress at `clock` as three [lon, lat] points: the stop left, the middle of the arc, the next stop; null
// while the person is still at a stop. The camera frames these, so the bend of the arc stays on screen too.
export function tripPointsAt(plan, places, clock) {
  const leg = legAt(plan, clock);
  if (clock < leg.leave) {
    return null;
  }
  const here = places.get(leg.here.place);
  const there = places.get(leg.next.place);
  const from = [here.lon, here.lat];
  const to = [there.lon, there.lat];
  return [from, arcPoint(from, to, ARC_MIDDLE), to];
}

// The place where the person is still at `clock`, or null during a trip.
export function stopAt(plan, clock) {
  const leg = legAt(plan, clock);
  return clock < leg.leave ? leg.here.place : null;
}

// The encounters of the person of the scene as meetings in time: the other person, the place, the level, the stay of
// the person of the scene (`ownStay`, to find its side in the card) and the window when both are surely there (the
// common part of the two inner intervals, in fractional years).
// An encounter of the scene always has the person on one side (src/api/scene.py, person scene).
export function meetings(scene, qid) {
  const stays = new Map(scene.stays.map((stay) => [stay.stay_id, stay]));
  return scene.encounters.map((encounter) => {
    const sides = [stays.get(encounter.stay_a), stays.get(encounter.stay_b)];
    const own = sides.find((stay) => stay.person === qid);
    const other = sides.find((stay) => stay !== own);
    return {
      id: `${encounter.stay_a}/${encounter.stay_b}`,
      other: other.person,
      ownStay: own.stay_id,
      place: other.place,
      level: encounter.level,
      start: Math.max(yearOf(own.inner_start), yearOf(other.inner_start)),
      end: Math.min(endYearOf(own.inner_end), endYearOf(other.inner_end)),
    };
  });
}

// The meeting is on screen at `clock`: inside its window, and the person is still at its place (not on the way).
export function meetingVisible(plan, meeting, clock) {
  return clock >= meeting.start && clock < meeting.end && stopAt(plan, clock) === meeting.place;
}

// The first moment the meeting is on screen (see meetingVisible), or null if never: the window of the meeting
// crossed with each stay of the person at its place, from the arrival to the departure. Used for the ticks of the
// time bar and to jump from one meeting to the next.
export function meetingMoment(plan, meeting) {
  for (const arrival of plan.arrivals) {
    if (arrival.place !== meeting.place) {
      continue;
    }
    const start = Math.max(arrival.arrive, meeting.start);
    const end = Math.min(legAt(plan, arrival.arrive).leave, meeting.end);
    if (start < end) {
      return start;
    }
  }
  return null;
}

// Where the person is at `clock`, for the labels: {here, next}, place QIDs; `next` is null while the person is still
// at a stop, the destination during a trip.
export function legPlacesAt(plan, clock) {
  const leg = legAt(plan, clock);
  return { here: leg.here.place, next: clock < leg.leave ? null : leg.next.place };
}

// When the person leaves the stop where it is still at `clock` (the start of the next trip); Infinity at the last
// stop, null during a trip.
export function leaveAt(plan, clock) {
  const leg = legAt(plan, clock);
  return clock < leg.leave ? leg.leave : null;
}
