// Entry of the MeeTime UI. Fifth step: the person view of one life. The face of the person moves along the track
// (animation.js), every trip the same length on screen; the people met appear above the place of each encounter, with
// a pulse, while both are there. A time bar plays, pauses, jumps from meeting to meeting and can be dragged with the
// mouse. A click on a face met opens the card of the encounter; the search opens another person, and the levels of the
// encounters (documented, or documented + plausible) are chosen in the time bar. No trail yet.

// Imported as MapLibreMap: a plain "Map" would hide the JavaScript Map collection in this module.
import { Map as MapLibreMap, Marker } from "./vendor/maplibre-gl-6.16.0/maplibre-gl.mjs";
import {
  endYearOf, leaveAt, legPlacesAt, meetingMoment, meetingVisible, meetings, positionAt, schedule, tripPointsAt,
  tripYearsAt, yearOf,
} from "./animation.js";

// Version of the site (semver). Changed only by scripts/bump-version.sh, never by hand.
const UI_VERSION = "0.2.0";

// Base map: OpenFreeMap, no key and no cookies, all styles on the same host (one CSP entry). Positron is light grey;
// liberty and bright are the coloured OSM look; dark and fiord (blue) are darker, served but not on the quick start
// page and not yet reworked by OpenFreeMap. While choosing, the page takes ?style=<name> (only names of this list).
const BASE_STYLE_ROOT = "https://tiles.openfreemap.org/styles/";
const BASE_STYLES = ["positron", "liberty", "bright", "dark", "fiord"];
const DEFAULT_BASE_STYLE = "bright";
const pageParameters = new URLSearchParams(window.location.search);
const askedStyle = pageParameters.get("style");

// A timeless map: the base map is today's (borders, roads, airports, today's names), so only the layers of nature are
// kept, a geography almost the same in 1600-1900. An ALLOW list, layer ids read from the bright style (2026-11-14):
// a layer added to the style later stays hidden. Canals are left out (mostly built later), seas and rivers keep their
// names. ?modern in the address shows the whole base map, to compare.
const TIMELESS_LAYERS = [
  "background", "landcover-glacier", "landcover-wood", "landcover-grass", "landcover-ice-shelf", "landcover-sand",
  "water", "water-intermittent", "waterway-river", "waterway-river-intermittent", "waterway-other",
  "waterway-other-intermittent", "waterway_line_label", "water_name_point_label", "water_name_line_label",
];
const SHOW_MODERN_MAP = pageParameters.has("modern");
const BASE_STYLE_URL = BASE_STYLE_ROOT + (BASE_STYLES.includes(askedStyle) ? askedStyle : DEFAULT_BASE_STYLE);

// First view: Western Europe, where most of the encounters are (Paris holds 405 of 1,026).
// MapLibre wants [longitude, latitude].
const START_CENTER = [8, 48];
// Zoom level of the first view: about the whole of Europe on a laptop screen.
const START_ZOOM = 3.5;

// The API on Azure Container Apps (scale to zero: the first call after a pause takes a few seconds). It changes
// together with connect-src in the CSP of index.html. To try a change of the API at home: uvicorn on port 8000,
// "http://127.0.0.1:8000" here and in connect-src.
const API_BASE_URL = "https://meetime-api.salmonwater-f8c25f7b.switzerlandnorth.azurecontainerapps.io";
// The person of the scene: ?person=<QID> in the address (set by the search), else Verdi, the test person of the whole
// chain (0 documented, 22 plausible encounters). Only a QID is accepted: the value goes into the API URL.
const DEFAULT_PERSON_QID = "Q7317";
const QID_PATTERN = /^Q[0-9]+$/;
const askedPerson = pageParameters.get("person") ?? "";
const PERSON_QID = QID_PATTERN.test(askedPerson) ? askedPerson : DEFAULT_PERSON_QID;
// ?year=<year> in the address: the clock of the scene starts there (kept inside the life of the person) and the search
// keeps only the people with an encounter that year. Up to four digits: the years of the corpus run from about 1600 to
// the 1970s.
const YEAR_PATTERN = /^[0-9]{1,4}$/;
const askedYear = pageParameters.get("year") ?? "";
const START_YEAR = YEAR_PATTERN.test(askedYear) ? Number(askedYear) : null;
// Years only, never months or days: the dates of the data are years (spec.md, "Year view"). An old ?month= in the
// address is ignored, and dropped at the next change of the year.
// Levels asked to the API, chosen with ?level=<choice> in the address (the selector of the time bar sets it): one level
// alone, or all of them. "all" is every level loaded: "possible" joins it when it is loaded.
// Default all: Verdi, the default person, has no documented encounter.
const LEVEL_CHOICES = {
  documented: { levels: ["documented"], label: "Documented" },
  plausible: { levels: ["plausible"], label: "Plausible" },
  all: { levels: ["documented", "plausible"], label: "All" },
};
const DEFAULT_LEVEL_CHOICE = "all";
const askedLevel = pageParameters.get("level") ?? "";
const LEVEL_CHOICE = Object.hasOwn(LEVEL_CHOICES, askedLevel) ? askedLevel : DEFAULT_LEVEL_CHOICE;
const LEVELS = LEVEL_CHOICES[LEVEL_CHOICE].levels;
// The view, the flag "Person | Year" of the search: ?view=year in the address gives the year view (a still picture of
// the encounters of a year, spec.md "Year view"); no parameter gives the person view (the animated life). A change of
// view loads the page again, like a change of person: the scene is built once per page.
const VIEW_YEAR = "year";
const YEAR_VIEW = pageParameters.get("view") === VIEW_YEAR;

// Colours (placeholders until the design): the track of the person, and the ring of the people met by level.
const TRACK_COLOR = "#c0392b";
// One hue per level, so the level reads at a glance (two blues were too close): green documented (certain), blue
// plausible, grey possible; none is the red of the track. Each is dark enough for white text (the name label,
// style.css): contrast with white 5.3, 5.5 and 5.5 (WCAG AA asks 4.5).
const ENCOUNTER_COLORS = { documented: "#1e7b4f", plausible: "#2e6da4", possible: "#5f6b6d" };
// The legend under the time bar, strongest level first. "possible" is in it but never shown yet (not loaded).
const LEGEND = [
  { level: "documented", label: "Documented (certain)" },
  { level: "plausible", label: "Plausible" },
  { level: "possible", label: "Possible" },
];
const NOT_LOADED_TITLE = "Not loaded yet";
// Sizes in pixels.
const TRACK_STOP_RADIUS = 5;
// The city where the person is now: a ring around its stop, wider than the stop and thinner than a face ring.
const CURRENT_STOP_RADIUS = 11;
const CURRENT_STOP_RING_WIDTH = 3;
// The timeless map has no city names: the stops of the track get their own label, to the RIGHT of the point (style.css),
// so the face and the name of the person standing on the stop never cover it (below the point they did).
// Two stops closer than this on screen, in pixels, share ONE label: a name is about 60 px wide and 14 px tall, so
// closer labels overlap. Recomputed at every zoom: close at Europe scale, apart zoomed in.
const LABEL_MERGE_PIXELS = 60;
// A shared label shows one name and how many more ("Milan +5"): the whole list on one line ran over the other labels
// and the faces (the north of Italy for Verdi). The list is in the tooltip; zooming in splits the group.
const MORE_NAMES_PREFIX = " +";
const LABEL_SEPARATOR = " \u00B7 "; // " · ", between the names of the tooltip
// The title of the browser tab: "<person> · MeeTime" (the page title on screen is the site only, index.html).
const SITE_NAME = "MeeTime";
const TITLE_SEPARATOR = " \u00B7 "; // " · "
// The people met on screen at one place sit in rows ABOVE it, so the person of the scene keeps the place itself and
// no name label (under each face) falls on another face. Pixels, from the point of the place to the centre of a face.
// Under the name of a person met, two short lines: the level ("PLAUSIBLE") and the year of the meeting ("1851").
// On one line they wrapped anyway and made the label wider than a seat.
const META_LINE_PIXELS = 14;
const META_LINES = 2;
// A face (36 px), its name label (up to two lines, about 30 px) and a gap.
const FACE_AND_NAME_PIXELS = 72;
// First row: a face with its name, meta line and gap stays above the face on the point.
const FIRST_ROW_OFFSET = FACE_AND_NAME_PIXELS + META_LINES * META_LINE_PIXELS;
// Distance between two rows: the same height.
const ROW_SPACING = FACE_AND_NAME_PIXELS + META_LINES * META_LINE_PIXELS;
// Distance between two faces of a row: the widest name label (110 px, style.css) plus a gap of 10 px, so the labels
// side by side never touch (100 px let two wide labels overlap in Paris).
const COLUMN_SPACING = 120;
// Faces per row: four rows of labels already span most of a laptop map; more go to the next row up.
const MAX_PER_ROW = 4;
// Portraits served with the site (src/retrieval/portraits.py): the index with the credits, and the folder of the
// images. Paths relative to the page.
const PORTRAITS_DIR = "portraits/";
const PORTRAITS_INDEX_URL = `${PORTRAITS_DIR}portraits.json`;
// Letters shown when a person has no portrait: the first letter of the first and of the last name word.
const INITIALS_COUNT = 2;
// Speed of the clock while the person is still at a stop: years of the life per second of screen time.
const YEARS_PER_SECOND = 1.5;
// Screen time of one trip, whatever its length in years: at YEARS_PER_SECOND a trip of a quarter of a year lasted
// a sixth of a second and looked like a jump. The clock slows down during a trip (tripYearsAt in animation.js).
const TRIP_SECONDS = 1.2;
// Longest step of the clock in one frame, in seconds: after a hidden tab or a slow frame the person does not jump.
const MAX_FRAME_SECONDS = 0.1;
// When a person met appears the clock stops this long, in seconds, so the meeting can be seen (the pulse runs on).
// 4 s since the label also carries the level and the year (3 s before).
const MEETING_PAUSE_SECONDS = 4;
const MILLISECONDS_PER_SECOND = 1000;
// Room left around the scene when the map zooms on it, in pixels.
const FIT_PADDING = 60;
// Time of the camera move after a jump of the clock (drag released, ticks, buttons), in seconds: slow enough to follow
// with the eyes (0.6 s felt like a jolt). A camera move at the start of a trip takes TRIP_SECONDS, in step with the person.
const CAMERA_JUMP_SECONDS = 1;
// Room left around the points when the camera follows, in pixels: twice FIT_PADDING, so after a move the person has
// space ahead and the camera moves less often.
const FOLLOW_PADDING = 2 * FIT_PADDING;

const map = new MapLibreMap({
  container: "map",
  style: BASE_STYLE_URL,
  center: START_CENTER,
  zoom: START_ZOOM,
});

// Errors of MapLibre (style, tiles, worker) go to the console, so a blocked request is easy to see. Before the style
// has loaded an error means no map at all (an ad blocker blocked tiles.openfreemap.org, seen 2026-11-15: the "load"
// event never comes): the notice says so. After it, a single missing tile is no reason to cover the map.
let styleLoaded = false;
map.on("error", (event) => {
  console.error("MapLibre error:", event.error);
  if (!styleLoaded) {
    // No map, so no scene will be drawn: the bar stops loading too.
    timebar.classList.remove("loading");
    clockDate.textContent = "The map could not be loaded";
    showLoadError("map", true);
  }
});

// The API scales to zero: a few minutes after the last call the replica stops, and the first call after the pause
// waits for a new one (measured 2026-11-16: 42 s cold, 0.2 s warm). Every API call goes through apiFetch: when a
// request is still waiting after SLOW_RESPONSE_SECONDS, a small panel says the server is waking up, so the page does
// not look stuck; it goes as soon as no API request is waiting. No extra ping: the page already asks /entries, /years
// and the scene at once when it opens, and the first of them wakes the server.
const SLOW_RESPONSE_SECONDS = 3;
const WAKING_TEXT = "Waking up the server...";
const WAKING_HINT = "The first visit after a pause can take up to a minute.";
// API requests sent and not answered yet, and the timer that shows the panel (null when none is waiting).
let pendingRequests = 0;
let slowTimer = null;
// The panel, built here (no change to index.html): the text classes of the notice, its own box in style.css.
const wakingPanel = makeElement("div", "");
wakingPanel.id = "waking";
wakingPanel.hidden = true;
wakingPanel.append(makeElement("p", "notice-text", WAKING_TEXT), makeElement("p", "notice-hint", WAKING_HINT));
document.body.append(wakingPanel);

// fetch on the API: `path` starts with "/". The timer starts with the first request of a batch and is cleared when the
// last one is answered; a request that fails (blocked, no network) also hides the panel, the error notice follows.
async function apiFetch(path) {
  pendingRequests += 1;
  if (slowTimer === null) {
    slowTimer = setTimeout(() => {
      wakingPanel.hidden = false;
    }, SLOW_RESPONSE_SECONDS * MILLISECONDS_PER_SECOND);
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`);
  } finally {
    pendingRequests -= 1;
    if (pendingRequests === 0) {
      clearTimeout(slowTimer);
      slowTimer = null;
      wakingPanel.hidden = true;
    }
  }
}

// The scene of one person from the API: people, places, stays, encounters (see src/api/scene.py).
async function fetchPersonScene(qid, levels) {
  const parameters = new URLSearchParams({ person: qid });
  for (const level of levels) {
    parameters.append("level", level);
  }
  const response = await apiFetch(`/scene?${parameters}`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function point(place, properties) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [place.lon, place.lat] }, properties };
}

// The stops of the track as GeoJSON, one point per place. No line through them: drawn whole, the line of a life with
// year-grain dates is a tangle; the trail behind the moving person will show the way instead.
function trackFeatures(plan, places) {
  const qids = [...new Set(plan.arrivals.map((arrival) => arrival.place))];
  const stops = qids.map((qidOfPlace) => point(places.get(qidOfPlace), { name: places.get(qidOfPlace).name }));
  return { stops: { type: "FeatureCollection", features: stops } };
}

// The index of the portraits ({QID: {file, artist, licence...}}). Without it every person shows initials.
async function fetchPortraits() {
  try {
    const response = await fetch(PORTRAITS_INDEX_URL);
    return response.ok ? await response.json() : {};
  } catch (error) {
    console.error("Portraits:", error);
    return {};
  }
}

// "Giuseppe Verdi" -> "GV"; one word -> its first letter.
function initials(name) {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const chosen = words.length < INITIALS_COUNT ? words : [words[0], words[words.length - 1]];
  return chosen.map((word) => word[0].toUpperCase()).join("");
}

// A person on the map: a wrapper (the Marker element) holding the face and the name under it. The Marker sets the
// transform AND the opacity of its own element (option `opacity`, read in maplibre-gl.mjs), so whatever we fade or
// pulse lives inside, never on the wrapper. The face is the round crop (style.css), or the initials without a
// portrait. Built with DOM calls, never innerHTML: names come from the data.
function figureElement(person, portrait, color) {
  const figure = document.createElement("div");
  figure.className = "figure";
  // A CSS variable, read by style.css for the ring and the pulse (set through the CSSOM: allowed by the CSP).
  figure.style.setProperty("--ring", color);
  const face = document.createElement("div");
  face.className = "face";
  face.title = person.name;
  if (portrait) {
    const image = document.createElement("img");
    image.src = PORTRAITS_DIR + portrait.file;
    image.alt = person.name;
    face.appendChild(image);
  } else {
    face.classList.add("face-initials");
    face.style.backgroundColor = color;
    face.textContent = initials(person.name);
  }
  const name = document.createElement("div");
  name.className = "figure-name";
  name.textContent = person.name;
  figure.append(face, name);
  return figure;
}

// [[west, south], [east, north]] around [lon, lat] points.
function boundsOf(points) {
  const longitudes = points.map(([lon]) => lon);
  const latitudes = points.map(([, lat]) => lat);
  return [[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]];
}

// [[west, south], [east, north]] around every place of the scene.
function sceneBounds(places) {
  return boundsOf([...places.values()].map((place) => [place.lon, place.lat]));
}

// The panels over the map: the title and the search at the top, the time bar at the bottom. A point under them is on
// the map but not on screen for the eye (Mozart in Vienna under the time bar).
const topPanels = [document.getElementById("title"), document.getElementById("search")];
const bottomPanel = document.getElementById("timebar");

// Pixels covered by the panels at the top and at the bottom of the map, measured now (the window can change size).
function coveredEdges() {
  const box = map.getContainer().getBoundingClientRect();
  const top = Math.max(...topPanels.map((panel) => panel.getBoundingClientRect().bottom)) - box.top;
  const bottom = box.bottom - bottomPanel.getBoundingClientRect().top;
  return { top: Math.max(0, top), bottom: Math.max(0, bottom) };
}

// Smallest free band, in pixels, that fitBounds must keep for the points: a face with its name label.
const MIN_FREE_PIXELS = FACE_AND_NAME_PIXELS;

// The padding of fitBounds: `room` pixels around the points, plus the panels at the top and at the bottom. In a short
// window (the dev tools open) panels plus room left no space and MapLibre refused ("Map cannot fit within canvas"):
// the room shrinks first, then the panels are ignored, so a band of MIN_FREE_PIXELS always stays.
function panelPadding(room) {
  const canvas = map.getContainer();
  let { top, bottom } = coveredEdges();
  if (canvas.clientHeight - top - bottom < MIN_FREE_PIXELS) {
    top = 0;
    bottom = 0;
  }
  const vertical = Math.max(0, Math.min(room, (canvas.clientHeight - top - bottom - MIN_FREE_PIXELS) / 2));
  const horizontal = Math.max(0, Math.min(room, (canvas.clientWidth - MIN_FREE_PIXELS) / 2));
  return { top: top + vertical, bottom: bottom + vertical, left: horizontal, right: horizontal };
}

// A point counts as visible only in the free part of the map: between the panels, and at least FIT_PADDING from
// every edge, so the face and the name label under it are not cut either.
function freelyVisible(lngLat) {
  const { top, bottom } = coveredEdges();
  const { x, y } = map.project(lngLat);
  const canvas = map.getContainer();
  return x >= FIT_PADDING && x <= canvas.clientWidth - FIT_PADDING
    && y >= top + FIT_PADDING && y <= canvas.clientHeight - bottom - FIT_PADDING;
}

// Moves the camera only if some of `points` are off screen or under a panel: frames them all in the free part of the
// map, with the zoom of the user as a ceiling, so the map pans when they fit at that zoom and zooms out only as much
// as needed. Never zooms in. One point gives an empty box: fitBounds then stops at the ceiling, which centres the
// point in the free part at the zoom of the user.
// linear: a straight glide (easeTo). The default of fitBounds is a flight (flyTo) that zooms out and back in on the
// way: too much motion for a camera that moves at every trip.
function keepOnScreen(points, seconds) {
  if (points.every(freelyVisible)) {
    return;
  }
  map.fitBounds(boundsOf(points), {
    padding: panelPadding(FOLLOW_PADDING), maxZoom: map.getZoom(), duration: seconds * MILLISECONDS_PER_SECOND,
    linear: true,
  });
}

// Years of the life per second of screen time at `clock`: slower during a trip, so it lasts TRIP_SECONDS.
function speedAt(plan, clock) {
  const trip = tripYearsAt(plan, clock);
  return trip > 0 ? trip / TRIP_SECONDS : YEARS_PER_SECOND;
}

// Pixel offset of seat `index` of `count` above a place: rows of at most MAX_PER_ROW, each row centred on the place,
// the first row nearest to it (y grows downwards on screen, so up is negative).
function seatOffset(index, count) {
  const row = Math.floor(index / MAX_PER_ROW);
  const inRow = Math.min(MAX_PER_ROW, count - row * MAX_PER_ROW);
  const column = index % MAX_PER_ROW;
  return [(column - (inRow - 1) / 2) * COLUMN_SPACING, -(FIRST_ROW_OFFSET + row * ROW_SPACING)];
}

// The faces on screen at each place share the seats: called when one appears or goes, so the seats are always for
// the faces actually there (16 meetings in Paris over a life, a few at a time).
function placeSeats(met) {
  const shownPerPlace = new Map();
  for (const face of met) {
    if (face.shown) {
      const list = shownPerPlace.get(face.meeting.place) ?? [];
      list.push(face);
      shownPerPlace.set(face.meeting.place, list);
    }
  }
  for (const list of shownPerPlace.values()) {
    list.forEach((face, index) => {
      const offset = seatOffset(index, list.length);
      face.marker.setOffset(offset);
      face.offset = offset; // read by keepSeatsOnScreen
      pointLeader(face.leader, offset);
    });
  }
}

// Half a face (36 px, style.css): from the centre of a seat to the top of its face.
const FACE_HALF_PIXELS = 18;
// Gap between a face on screen and a panel or the edge of the map, so the two never touch.
const SEAT_MARGIN_PIXELS = 12;

// The faces met sit in rows ABOVE their place, a fixed number of pixels away: with the place low on the map they
// went under the search (Alexander I over Napoleon at Erfurt). When the faces on screen change, the map pans just
// enough to bring all of them, and the person of the scene with its name, into the free part of the map (between the
// panels, coveredEdges). Pan only: a zoom does not help, the seats are in pixels. If a camera move is running (a jump
// of the clock glides to the person), the check waits for its end, else it would measure the old view.
function keepSeatsOnScreen(met) {
  const shown = met.filter((face) => face.shown);
  if (shown.length === 0) {
    return;
  }
  if (map.isMoving()) {
    map.once("moveend", () => keepSeatsOnScreen(met));
    return;
  }
  const { top, bottom } = coveredEdges();
  const canvas = map.getContainer();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const face of shown) {
    const place = map.project(face.lngLat);
    const [dx, dy] = face.offset;
    minX = Math.min(minX, place.x + dx - COLUMN_SPACING / 2);
    maxX = Math.max(maxX, place.x + dx + COLUMN_SPACING / 2);
    minY = Math.min(minY, place.y + dy - FACE_HALF_PIXELS);
    // The person of the scene stands on the place, its name under the face.
    maxY = Math.max(maxY, place.y + FACE_AND_NAME_PIXELS);
  }
  const free = {
    left: SEAT_MARGIN_PIXELS,
    right: canvas.clientWidth - SEAT_MARGIN_PIXELS,
    top: top + SEAT_MARGIN_PIXELS,
    bottom: canvas.clientHeight - bottom - SEAT_MARGIN_PIXELS,
  };
  // How far the content must move (positive: right or down). Too wide or too tall to fit: the top and the left win,
  // where the faces met are.
  const shiftX = minX < free.left ? free.left - minX : Math.min(0, free.right - maxX);
  const shiftY = minY < free.top ? free.top - minY : Math.min(0, free.bottom - maxY);
  if (shiftX !== 0 || shiftY !== 0) {
    // panBy moves the centre of the map: the content moves the other way.
    map.panBy([-shiftX, -shiftY], { duration: CAMERA_JUMP_SECONDS * MILLISECONDS_PER_SECOND });
  }
}

// The leader line of a face met: from the place of the meeting to the centre of the face, along the seat offset.
// At Europe scale a seat is hundreds of kilometres away from its place (Sand over the North Sea while she meets
// Chopin in Paris): the line says where the meeting is. It starts under the face of the person of the scene, who
// stands on that place, and ends under the face met.
function pointLeader(line, [dx, dy]) {
  line.style.width = `${Math.hypot(dx, dy)}px`;
  line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

// One hidden figure per meeting at its place. The ring is solid for documented, dashed for plausible (style.css).
// Under the name, one per line: the level, in capitals, and the year the meeting comes on screen (its first
// moment, the date of its tick in the time bar). A meeting never on screen has no moment and shows the level only.
function meetingMarkers(scene, qid, plan, places, portraits) {
  const people = new Map(scene.people.map((person) => [person.qid, person]));
  const meetingsOfScene = meetings(scene, qid);
  // The leader lines first, each in its own Marker on the place (a zero-size anchor, like the stop labels): a Marker
  // added earlier sits under the later ones, so EVERY line passes under EVERY face and name label. Inside the Marker
  // of its face a line went over the labels of the faces added after it (Mendelssohn's line across Champollion).
  const leaders = meetingsOfScene.map((meeting) => {
    const anchor = makeElement("div", `leader-anchor figure-met figure-${meeting.level}`);
    anchor.style.setProperty("--ring", ENCOUNTER_COLORS[meeting.level]);
    const line = makeElement("div", "figure-leader");
    anchor.append(line);
    const place = places.get(meeting.place);
    new Marker({ element: anchor }).setLngLat([place.lon, place.lat]).addTo(map);
    return { anchor, line };
  });
  return meetingsOfScene.map((meeting, index) => {
    const color = ENCOUNTER_COLORS[meeting.level];
    const element = figureElement(people.get(meeting.other), portraits[meeting.other], color);
    element.classList.add("figure-met", `figure-${meeting.level}`);
    const moment = meetingMoment(plan, meeting);
    const meta = makeElement("span", "figure-meta");
    meta.append(makeElement("span", "figure-level", meeting.level));
    if (moment !== null) {
      meta.append(makeElement("span", "figure-date", clockLabel(moment)));
    }
    element.querySelector(".figure-name").append(meta);
    const leader = leaders[index].line;
    const leaderAnchor = leaders[index].anchor;
    const place = places.get(meeting.place);
    const marker = new Marker({ element }).setLngLat([place.lon, place.lat]).addTo(map);
    const name = people.get(meeting.other).name;
    return {
      meeting, element, marker, leader, leaderAnchor, name, moment, lngLat: [place.lon, place.lat], shown: false,
    };
  });
}

// The clock runs from the first stop to the end of the last one. At each frame the face moves to its place (a Marker
// is moved by the browser with a CSS transform, no trip through the map worker) and each face met is shown or hidden.
// Adding the class again restarts its pulse. A face that appears stops the clock for MEETING_PAUSE_SECONDS.
// "1851" for the clock 1851.45: the year only, the grain of the data (spec.md, "Year view").
function clockLabel(clock) {
  return String(Math.floor(clock));
}

// The time bar under the map: play / pause, previous and next meeting, the date, and a track to drag with the mouse.
// The meetings are ticks on the track. Every position is a pure function of the clock (animation.js), so the clock
// can jump anywhere, backwards too.
const timebar = document.getElementById("timebar");
const clockDate = document.getElementById("clock-date");
const clockPlace = document.getElementById("clock-place");
const clockFill = document.getElementById("clock-fill");
const thumb = document.getElementById("thumb");
const track = document.getElementById("track");
const ticks = document.getElementById("ticks");
const playButton = document.getElementById("play");
const previousButton = document.getElementById("previous-meeting");
const nextButton = document.getElementById("next-meeting");

// The card of an encounter: a panel with the sentences of the sources (src/api/card.py, GET /encounters/{a}/{b}).
const card = document.getElementById("card");
const cardBody = document.getElementById("card-body");
document.getElementById("card-close").addEventListener("click", () => {
  card.hidden = true;
});
// Cards already asked, by encounter id: a second click does not call the API again.
const cards = new Map();
// "1850-08-01" -> "1850": the dates of the data are years.
const YEAR_LENGTH = 4;

async function fetchCard(id) {
  if (!cards.has(id)) {
    const response = await apiFetch(`/encounters/${id}`);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${await response.text()}`);
    }
    cards.set(id, await response.json());
  }
  return cards.get(id);
}

// A new element with a class and a text (DOM calls only, never innerHTML: the texts come from the data).
function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// A link that opens in a new tab, with no access back to this page (noopener) and no referrer.
function makeLink(className, text, url) {
  const link = makeElement("a", className, text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

// The English Wikipedia article of a person from its QID alone: a Wikidata page that redirects to the article linked
// to the item (no title needed, no API change).
const WIKIPEDIA_BY_QID = "https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/";

function wikipediaUrl(qid) {
  return WIKIPEDIA_BY_QID + qid;
}

// The name of a person as a link to their article that asks first (askToOpen), like the face of the person of the
// scene. Still a real link: the address shows under the mouse, and a middle click opens it with no question.
function articleLink(className, name, qid) {
  const link = makeLink(className, name, wikipediaUrl(qid));
  link.addEventListener("click", (event) => {
    event.preventDefault();
    askToOpen(`the Wikipedia article of ${name}`, link.href);
  });
  return link;
}

// The portraits of the scene ({QID: {artist, licence, licence_url, page...}}, src/retrieval/portraits.py): set when the
// scene is loaded, read by the card for the credits.
let portraitIndex = {};
const UNKNOWN_ARTIST = "Unknown author";
const CREDIT_SEPARATOR = " · "; // " · "

// "Portrait: Ferdinand Mulnier · Public domain · Commons": the author, the licence (a link when Commons gives its URL)
// and the file page on Commons, which holds the full terms. Some licences (CC BY, CC BY-SA) ask for this attribution.
// `label` starts the line: "Portrait" in the card, the name of the person in the credits (`linked`: the name is a link
// to the person's article). No portrait: no line.
function portraitCredit(qid, label = "Portrait", linked = false) {
  const portrait = portraitIndex[qid];
  if (portrait === undefined) {
    return null;
  }
  const line = makeElement("div", "card-credit");
  line.append(linked ? articleLink("card-link", label, qid) : label, `: ${portrait.artist || UNKNOWN_ARTIST}`);
  if (portrait.licence) {
    line.append(CREDIT_SEPARATOR);
    line.append(portrait.licence_url ? makeLink("card-link", portrait.licence, portrait.licence_url) : portrait.licence);
  }
  line.append(CREDIT_SEPARATOR, makeLink("card-link", "Commons", portrait.page));
  return line;
}

// The licences of the texts and data in the card, once at its foot. Each quotation already links its exact revision.
const WIKIPEDIA_URL = "https://en.wikipedia.org/";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const WIKIDATA_URL = "https://www.wikidata.org/";
const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

function cardAttribution() {
  const line = makeElement("p", "card-attribution", "Quotations from ");
  line.append(
    makeLink("card-link", "English Wikipedia", WIKIPEDIA_URL), " (", makeLink("card-link", "CC BY-SA 4.0", CC_BY_SA_URL),
    "), each linked to its revision. Data from ", makeLink("card-link", "Wikidata", WIKIDATA_URL), " (",
    makeLink("card-link", "CC0", CC0_URL), ").",
  );
  return line;
}

// The people of the scene (set by drawPersonScene), for the credits of their portraits.
let scenePeople = [];
// The map and its library: the same names as the attribution control at the bottom right of the map, with links.
const MAP_CREDITS = [
  ["MapLibre GL JS", "https://maplibre.org/", " (BSD-3-Clause), base map from "],
  ["OpenFreeMap", "https://openfreemap.org/", ", "],
  ["OpenMapTiles", "https://openmaptiles.org/", ", data "],
  ["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright", "."],
];

// The versions of the three parts, each with its own (spec.md, "Versioning"): the site (UI_VERSION), the API and the
// data (GET /version, src/api/main.py). Asked once, at the first opening of the credits, not with the page: few
// visitors open them. A failed call is asked again at the next opening.
const VERSION_LOADING = "...";
// The data have no version when Aura holds no Meta node (a load broken halfway): the API answers null.
const VERSION_UNKNOWN = "unknown";
const VERSION_NOT_REACHED = "not reached";
let versionsReady = null;

async function fetchVersions() {
  const response = await apiFetch(`/version`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// "Site 0.1.0 · API 0.2.0 · Data data-20261115T2011Z".
function versionsText(api, data) {
  return `Site ${UI_VERSION}${CREDIT_SEPARATOR}API ${api}${CREDIT_SEPARATOR}Data ${data}`;
}

// The line of the versions: the site at once, API and data filled when /version answers. Texts from the API go in
// with textContent, like every text from the data.
function versionsLine() {
  const line = makeElement("p", "card-attribution", versionsText(VERSION_LOADING, VERSION_LOADING));
  versionsReady ??= fetchVersions().catch((error) => {
    versionsReady = null;
    throw error;
  });
  versionsReady
    .then((versions) => {
      line.textContent = versionsText(versions.api, versions.data ?? VERSION_UNKNOWN);
    })
    .catch((error) => {
      console.error("Versions:", error);
      line.textContent = versionsText(VERSION_NOT_REACHED, VERSION_NOT_REACHED);
    });
  return line;
}

// The credits of the scene in the card panel: the portrait of every person of the scene (the person of the scene
// first, then by name), the licences of texts and data, the map, the versions. Before the scene is loaded, no portrait
// is listed.
function showCredits() {
  card.hidden = false;
  const people = [...scenePeople].sort((one, two) => {
    if (one.qid === PERSON_QID || two.qid === PERSON_QID) {
      return one.qid === PERSON_QID ? -1 : 1;
    }
    return one.name.localeCompare(two.name);
  });
  const portraits = people.map((person) => portraitCredit(person.qid, person.name, true)).filter((line) => line !== null);
  const mapLine = makeElement("p", "card-attribution credits-map", "Map: ");
  for (const [text, url, after] of MAP_CREDITS) {
    mapLine.append(makeLink("card-link", text, url), after);
  }
  cardBody.replaceChildren(
    makeElement("h2", "card-title", "Credits"),
    makeElement("h3", "credits-heading", "Portraits"),
    ...portraits,
    makeElement("h3", "credits-heading", "Texts and data"),
    cardAttribution(),
    makeElement("h3", "credits-heading", "Map"),
    mapLine,
    makeElement("h3", "credits-heading", "Versions"),
    versionsLine(),
  );
}
document.getElementById("credits-open").addEventListener("click", showCredits);

function years(start, end) {
  const first = start.slice(0, YEAR_LENGTH);
  const last = end.slice(0, YEAR_LENGTH);
  return first === last ? first : `${first}-${last}`;
}

// One side of the card: the person, the years of the stay (and the level of the meeting, for a person met), and its
// sources. A text source shows its sentence and a
// link to the exact revision of the Wikipedia article (also the attribution of the quoted text, CC BY-SA); a Wikidata
// source shows its kind and years with a link to the person on Wikidata. The same sentence twice (a known duplicate
// of the dedupe, spec.md Open) is shown once. `qid`: the person of the side, for the credit of the portrait.
function cardSide(side, qid, level) {
  const section = makeElement("section", "card-side");
  // The name opens the person's Wikipedia article in a new tab.
  const heading = makeElement("h3", "card-person");
  heading.append(articleLink("card-person-link", side.person.name, qid));
  section.append(heading);
  const credit = portraitCredit(qid);
  if (credit !== null) {
    section.append(credit);
  }
  const stayYears = years(side.stay.inner_start, side.stay.inner_end);
  const levelText = level === undefined ? "" : `, ${level}`;
  section.append(makeElement("div", "card-years", `in ${side.stay.place_text ?? ""} ${stayYears}${levelText}`));
  const seen = new Set();
  for (const source of side.sources) {
    const key = source.sentence ?? source.url + source.kind;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const entry = makeElement("div", "card-source");
    if (source.source === "text") {
      entry.append(makeElement("blockquote", "card-sentence", source.sentence));
    } else {
      entry.append(makeElement("div", "card-fact", `Wikidata: ${source.kind}, ${years(source.inner_start, source.inner_end)}`));
    }
    entry.append(makeLink("card-link", source.source === "text" ? "Wikipedia" : "Wikidata", source.url));
    section.append(entry);
  }
  return section;
}

// "A, B and C": the names in the title of the card.
const NAME_LIST_FORMAT = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

// Opens the card of the people met at one place at one moment: everyone on screen there, not only the face clicked
// (Verdi in Paris meets Chopin and Comte together). One encounter card per person met (GET /encounters, cached), merged:
// the title lists everybody, the person of the scene comes first, once per stay of theirs, then each person met with
// the level of the meeting. The side of the person of the scene is found by its stay (meeting.ownStay).
async function showCard(group) {
  card.hidden = false;
  cardBody.replaceChildren(makeElement("p", "card-loading", "Loading the sources..."));
  try {
    const cardsOfGroup = await Promise.all(group.map((meeting) => fetchCard(meeting.id)));
    const ownSides = new Map();
    const otherSides = [];
    cardsOfGroup.forEach((data, index) => {
      const meeting = group[index];
      const ownIsA = data.side_a.stay.stay_id === meeting.ownStay;
      const own = ownIsA ? data.side_a : data.side_b;
      ownSides.set(own.stay.stay_id, own);
      otherSides.push({ side: ownIsA ? data.side_b : data.side_a, level: meeting.level, qid: meeting.other });
    });
    const ownName = [...ownSides.values()][0].person.name;
    const names = [ownName, ...otherSides.map(({ side }) => side.person.name)];
    const title = makeElement("h2", "card-title", NAME_LIST_FORMAT.format(names));
    const where = makeElement("div", "card-where", cardsOfGroup[0].place.name);
    const sections = [
      ...[...ownSides.values()].map((side) => cardSide(side, PERSON_QID)),
      ...otherSides.map(({ side, level, qid }) => cardSide(side, qid, level)),
    ];
    cardBody.replaceChildren(title, where, ...sections, cardAttribution());
  } catch (error) {
    console.error("Card:", error);
    cardBody.replaceChildren(makeElement("p", "card-loading", "The sources could not be loaded (see the console)."));
  }
}
const PLAY_SYMBOL = "▶"; // ▶
const PAUSE_SYMBOL = "❚❚"; // ❚❚
const PERCENT = 100;
// A meeting "before" or "after" the clock must be at least this far from it, in years (about 9 hours): standing on a
// meeting, "next" goes to the following one, not to the same.
const STEP_EPSILON_YEARS = 0.001;

// Share of the life already run at `clock`, 0 to 1.
function share(plan, clock) {
  return (clock - plan.first) / (plan.last - plan.first);
}

// One tick per meeting that is ever on screen, at its first moment, in the colour of its level; the title tells who
// and when. A meeting never on screen gets no tick (counted in the console).
function drawTicks(plan, met) {
  for (const face of met) {
    if (face.moment === null) {
      continue;
    }
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = `${share(plan, face.moment) * PERCENT}%`;
    tick.style.setProperty("--ring", ENCOUNTER_COLORS[face.meeting.level]);
    tick.title = `${face.name}, ${clockLabel(face.moment)}`;
    ticks.appendChild(tick);
  }
}

// The clock of the scene and its controls. The loop runs at every frame; the clock moves only while playing, not
// during the pause of a meeting and not while the mouse drags the track.
// The date and the city in the time bar ("1851" over "Paris"; "Milan to Paris" during a trip), and the ring on
// the city of the map. The ring source is updated only when the city changes, not at every frame.
function cityTracker(plan, places) {
  const ring = map.getSource("current-stop");
  let lastHere = null;
  return (clock) => {
    const { here, next } = legPlacesAt(plan, clock);
    const where = next === null ? places.get(here).name : `${places.get(here).name} to ${places.get(next).name}`;
    clockDate.textContent = clockLabel(clock);
    clockPlace.textContent = where;
    if (here !== lastHere) {
      ring.setData(point(places.get(here), {}));
      lastHere = here;
    }
  };
}

function runClock(plan, places, marker, met, marks) {
  const showCity = cityTracker(plan, places);
  // journeys: play the whole life, trips included (the box "Journeys" of the time bar); off by default, the clock then
  // jumps from meeting to meeting.
  const state = { clock: plan.first, playing: true, dragging: false, pause: 0, journeys: journeysBox.checked };
  if (START_YEAR !== null) {
    // The clock is a fractional year: the year itself is its first day.
    state.clock = Math.min(plan.last, Math.max(plan.first, START_YEAR));
  }
  const moments = met.map((face) => face.moment).filter((moment) => moment !== null).sort((one, two) => one - two);
  let previous = null;
  // True while a trip is in progress: its start is the moment the camera checks the destination.
  let onTrip = false;

  // A click on a face met stops the clock and opens the card of everyone met on screen at that place (seat order).
  for (const face of met) {
    face.element.addEventListener("click", () => {
      setPlaying(false);
      const here = met.filter((one) => one.shown && one.meeting.place === face.meeting.place);
      showCard(here.map((one) => one.meeting));
    });
  }

  function setPlaying(playing) {
    state.playing = playing;
    playButton.textContent = playing ? PAUSE_SYMBOL : PLAY_SYMBOL;
  }

  // Jump to a clock value (drag, ticks, buttons). The pause of a meeting is for playing, not for jumps.
  function jump(clock) {
    state.clock = Math.min(plan.last, Math.max(plan.first, clock));
    state.pause = 0;
  }

  // After a jump the person may be off screen: the camera goes to it (keepOnScreen, zoom of the user kept).
  function followPerson() {
    keepOnScreen([positionAt(plan, places, state.clock)], CAMERA_JUMP_SECONDS);
  }

  function clockAtPointer(event) {
    const box = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    return plan.first + fraction * (plan.last - plan.first);
  }

  // Drag: pointer events with capture, so the drag goes on when the mouse leaves the track.
  track.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    track.setPointerCapture(event.pointerId);
    jump(clockAtPointer(event));
  });
  track.addEventListener("pointermove", (event) => {
    if (state.dragging) {
      jump(clockAtPointer(event));
    }
  });
  // The camera waits for the end of the drag: following every move would make the map shake.
  const stopDragging = () => {
    if (state.dragging) {
      state.dragging = false;
      followPerson();
    }
  };
  track.addEventListener("pointerup", stopDragging);
  track.addEventListener("pointercancel", stopDragging);

  playButton.addEventListener("click", () => {
    // At the end, play starts the life again.
    if (!state.playing && state.clock >= plan.last) {
      jump(plan.first);
      followPerson();
    }
    setPlaying(!state.playing);
  });
  previousButton.addEventListener("click", () => {
    const before = moments.filter((moment) => moment < state.clock - STEP_EPSILON_YEARS);
    jump(before.length > 0 ? before[before.length - 1] : plan.first);
    followPerson();
  });
  nextButton.addEventListener("click", () => {
    const after = moments.find((moment) => moment > state.clock + STEP_EPSILON_YEARS);
    if (after !== undefined) {
      jump(after);
      followPerson();
    }
  });
  previousButton.disabled = false;
  nextButton.disabled = false;
  playButton.disabled = false;
  setPlaying(true);

  // The year field moves the clock of this scene (kept inside the life).
  playClock = setPlaying;
  clockIsPlaying = () => state.playing;
  journeysBox.addEventListener("change", () => {
    state.journeys = journeysBox.checked;
  });
  journeysBox.disabled = false;
  showJourneys = () => {
    journeysBox.checked = true;
    state.journeys = true;
  };
  jumpToClock = (clock) => {
    jump(clock);
    followPerson();
  };

  // The clock after `seconds` of play. A trip runs (the movement is the show); at a stop the clock jumps at once to the
  // next meeting or to the departure, whichever comes first (the end of the life at the last stop): the years with
  // nothing new are skipped. The meeting that appears then stops the clock for its pause.
  function nextClock(clock, seconds) {
    const leave = leaveAt(plan, clock);
    if (leave === null) {
      return clock + seconds * speedAt(plan, clock);
    }
    const meeting = moments.find((moment) => moment > clock + STEP_EPSILON_YEARS);
    return Math.min(leave, meeting ?? Infinity, plan.last);
  }

  // Without the journeys: straight to the next meeting (its first moment on screen), the camera follows; after the last
  // meeting, the end of the life. The face that appears stops the clock for its pause, then the next jump.
  function jumpToNextMeeting() {
    const after = moments.find((moment) => moment > state.clock + STEP_EPSILON_YEARS);
    jump(after ?? plan.last);
    followPerson();
  }

  function frame(now) {
    if (previous !== null) {
      const seconds = Math.min(MAX_FRAME_SECONDS, (now - previous) / MILLISECONDS_PER_SECOND);
      if (state.pause > 0) {
        state.pause = Math.max(0, state.pause - seconds);
      } else if (state.playing && !state.dragging) {
        if (state.journeys) {
          state.clock = Math.min(plan.last, nextClock(state.clock, seconds));
        } else {
          jumpToNextMeeting();
        }
        if (state.clock >= plan.last) {
          setPlaying(false);
        }
      }
    }
    previous = now;
    marker.setLngLat(positionAt(plan, places, state.clock));
    // A trip starts: if the destination (or the bend of the arc) is off screen, the camera frames the trip, moving in
    // step with the person. Not while dragging: the camera waits for the release (stopDragging).
    const trip = tripPointsAt(plan, places, state.clock);
    if (trip !== null && !onTrip && !state.dragging) {
      keepOnScreen(trip, TRIP_SECONDS);
    }
    onTrip = trip !== null;
    // Birth and death marks: on screen once the clock has reached them (the birth from the start).
    for (const mark of marks) {
      mark.element.hidden = state.clock < mark.moment;
    }
    showCity(state.clock);
    clockFill.style.transform = `scaleX(${share(plan, state.clock)})`;
    thumb.style.left = `${share(plan, state.clock) * PERCENT}%`;
    let changed = false;
    for (const face of met) {
      const visible = meetingVisible(plan, face.meeting, state.clock);
      if (visible !== face.shown) {
        face.element.classList.toggle("figure-shown", visible);
        face.leaderAnchor.classList.toggle("figure-shown", visible);
        face.shown = visible;
        changed = true;
        // A person appearing while the life plays stops the clock; two in the same frame give one pause.
        if (visible && state.playing && !state.dragging) {
          state.pause = MEETING_PAUSE_SECONDS;
        }
      }
    }
    if (changed) {
      placeSeats(met);
      keepSeatsOnScreen(met);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Birth and death of the person on the map: "* 1813" at the birth place, "† 1901" at the death place,
// shown once the clock reaches them. The scene has no kind on its stays (`kind` lives only in the sources), so they are
// found by their dates: the narrowest stay starting in the birth year, and the narrowest stay ending in the last year
// of the life (birth_year and last_year of the person). None found: no mark.
const BIRTH_SIGN = "*";
const DEATH_SIGN = "\u2020"; // "†"

function yearOfIso(iso) {
  return Number(iso.slice(0, YEAR_LENGTH));
}

// The stay with the shortest inner interval (a day before a year); on a tie the earliest, or the latest with `later`.
function narrowest(stays, later) {
  const width = (stay) => endYearOf(stay.inner_end) - yearOf(stay.inner_start);
  const start = (stay) => yearOf(stay.inner_start);
  const direction = later ? -1 : 1;
  return [...stays].sort((one, two) => width(one) - width(two) || direction * (start(one) - start(two)))[0];
}

function lifeMarks(stays, person, places) {
  const dated = stays.filter((stay) => stay.inner_start && stay.inner_end);
  const birth = narrowest(dated.filter((stay) => yearOfIso(stay.inner_start) === person.birth_year), false);
  const death = narrowest(dated.filter((stay) => yearOfIso(stay.inner_end) === person.last_year), true);
  const marks = [];
  for (const [stay, sign, moment, kind] of [
    [birth, BIRTH_SIGN, birth && yearOf(birth.inner_start), "birth"],
    [death, DEATH_SIGN, death && yearOf(death.inner_start), "death"],
  ]) {
    if (stay === undefined) {
      continue;
    }
    const place = places.get(stay.place);
    // A zero-size anchor on the point; the text sits right of it, above the stop label (style.css).
    const element = makeElement("div", "life-mark");
    const label = `${sign} ${clockLabel(moment)}`;
    const text = makeElement("span", `life-mark-text life-mark-${kind}`, label);
    text.title = `${kind === "birth" ? "Born" : "Died"} in ${place.name}`;
    element.append(text);
    element.hidden = true;
    new Marker({ element }).setLngLat([place.lon, place.lat]).addTo(map);
    marks.push({ element, moment });
  }
  return marks;
}

// Years the person spent at each place (inner intervals of its stays): the longer stay keeps its label on top when
// two stops share one.
function yearsPerPlace(stays) {
  const years = new Map();
  for (const stay of stays) {
    const length = endYearOf(stay.inner_end) - yearOf(stay.inner_start);
    years.set(stay.place, (years.get(stay.place) ?? 0) + length);
  }
  return years;
}

// One name label per stop of the track (an HTML Marker, styled in style.css: no map fonts needed). Stops close on
// screen are grouped: the place with the most years gives the label ("Milan +5", the names in the tooltip); the other
// labels of the group are hidden. Greedy, from the most years down, at every zoom.
function stopLabels(plan, places, stays) {
  const years = yearsPerPlace(stays);
  const qids = [...new Set(plan.arrivals.map((arrival) => arrival.place))]
    .sort((one, two) => (years.get(two) ?? 0) - (years.get(one) ?? 0));
  const labels = qids.map((qidOfPlace) => {
    const place = places.get(qidOfPlace);
    // A zero-size anchor on the point; the text is placed right of it by style.css.
    const element = makeElement("div", "stop-label");
    const text = makeElement("span", "stop-label-text");
    element.append(text);
    new Marker({ element }).setLngLat([place.lon, place.lat]).addTo(map);
    return { place, element, text };
  });

  function arrange() {
    const groups = [];
    for (const label of labels) {
      const point = map.project([label.place.lon, label.place.lat]);
      const group = groups.find((one) => Math.hypot(one.point.x - point.x, one.point.y - point.y) < LABEL_MERGE_PIXELS);
      if (group) {
        group.names.push(label.place.name);
        label.element.hidden = true;
      } else {
        groups.push({ point, names: [label.place.name], label });
        label.element.hidden = false;
      }
    }
    for (const group of groups) {
      const more = group.names.length - 1;
      group.label.text.textContent = group.names[0] + (more > 0 ? `${MORE_NAMES_PREFIX}${more}` : "");
      group.label.text.title = more > 0 ? group.names.join(LABEL_SEPARATOR) : "";
    }
  }
  arrange();
  map.on("zoom", arrange);
}

function drawPersonScene(scene, qid, portraits) {
  const places = new Map(scene.places.map((place) => [place.qid, place]));
  scenePeople = scene.people;
  // The meetings order the stops that start together (schedule): the stop of a meeting comes in its window.
  const plan = schedule(scene.stays.filter((stay) => stay.person === qid), meetings(scene, qid));
  const track = trackFeatures(plan, places);

  map.addSource("track-stops", { type: "geojson", data: track.stops });
  map.addLayer({
    id: "track-stops", type: "circle", source: "track-stops",
    paint: { "circle-radius": TRACK_STOP_RADIUS, "circle-color": TRACK_COLOR },
  });
  // The ring on the current city starts on the first stop; cityTracker moves it.
  map.addSource("current-stop", { type: "geojson", data: point(places.get(plan.arrivals[0].place), {}) });
  map.addLayer({
    id: "current-stop", type: "circle", source: "current-stop",
    paint: {
      "circle-radius": CURRENT_STOP_RADIUS,
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-width": CURRENT_STOP_RING_WIDTH,
      "circle-stroke-color": TRACK_COLOR,
    },
  });
  // The stop names first, then the faces met, the person last: a Marker added later sits on top.
  stopLabels(plan, places, scene.stays.filter((stay) => stay.person === qid));
  const person = scene.people.find((one) => one.qid === qid);
  const marks = lifeMarks(scene.stays.filter((stay) => stay.person === qid), person, places);
  const met = meetingMarkers(scene, qid, plan, places, portraits);
  document.title = `${person.name}${TITLE_SEPARATOR}${SITE_NAME}`;
  showSearchedPerson(person.name);
  const own = figureElement(person, portraits[qid], TRACK_COLOR);
  own.classList.add("figure-main");
  // A click on the face of the person of the scene opens their Wikipedia article in a new tab: with no encounter on
  // screen there is no card, and so no other way to the article.
  // On the face, not the wrapper: the face has its own title (the name), which the browser would show instead.
  own.querySelector(".face").title = `${person.name}: open the Wikipedia article`;
  own.addEventListener("click", () => askToOpen(`the Wikipedia article of ${person.name}`, wikipediaUrl(qid)));
  const marker = new Marker({ element: own })
    .setLngLat(positionAt(plan, places, plan.first))
    .addTo(map);

  map.fitBounds(sceneBounds(places), { padding: panelPadding(FIT_PADDING) });
  console.log(`${qid}: ${track.stops.features.length} places on the track, ${scene.encounters.length} encounters`);
  console.log(`${qid}: ${plan.arrivals.length} arrivals, clock ${plan.first.toFixed(2)} to ${plan.last.toFixed(2)}`);
  console.log(`${qid}: portrait ${portraits[qid] ? portraits[qid].file : "none, initials"}`);
  // A meeting never on screen: its window falls while the schedule has the person elsewhere (a tour, see schedule).
  const onScreen = met.filter((face) => face.moment !== null).length;
  console.log(`${qid}: meetings on screen ${onScreen} of ${met.length}`);
  drawTicks(plan, met);
  runClock(plan, places, marker, met, marks);
  // Empty for the eye too: encounters that never come on screen (a window that falls while the schedule has the
  // person elsewhere) leave the same map with no face and no tick.
  if (scene.encounters.length === 0 || onScreen === 0) {
    showEmptyNotice(person, scene.encounters.length);
  }
}

// Hides every layer of the base map that is not in TIMELESS_LAYERS. Must run before our own layers are added.
function hideModernLayers() {
  for (const layer of map.getStyle().layers) {
    if (!TIMELESS_LAYERS.includes(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

// --- Search ---------------------------------------------------------------------------------------------------------

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchToggle = document.getElementById("search-toggle");
const searchYear = document.getElementById("search-year");
// The name of the person of the scene: the field shows it when nothing is being typed.
let searchedName = "";
// Moves the clock of the scene: set by runClock when the scene is there, null before.
let jumpToClock = null;
// Plays (true) or pauses (false) the clock of the scene: set by runClock, null before. Used by the notice.
let playClock = null;
// True while the clock plays: set by runClock, null before. Used to resume after the question of askToOpen.
let clockIsPlaying = null;
// Turns the journeys on (the box and the clock): set by runClock, null before. Used by the notice of an empty scene.
let showJourneys = null;
// The box "Journeys" of the time bar: off by default, the clock jumps from meeting to meeting.
const journeysBox = document.getElementById("journeys");

function showSearchedPerson(name) {
  searchedName = name;
  if (document.activeElement !== searchInput) {
    searchInput.value = name;
  }
}

// Every person and place with at least one encounter (src/api/entries.py), asked once when the page opens.
async function fetchEntries() {
  const response = await apiFetch(`/entries`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// Lower case without accents: "ther" finds "Thérèse" (NFD splits a letter from its accent, \p{M} drops the accent).
function fold(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Encounters of a person at the levels shown (the counts per level of /entries; a missing count is 0).
function encounterCount(person) {
  return LEVELS.reduce((total, level) => total + (person[level] ?? 0), 0);
}

// The people whose name holds the query (an empty query holds every name), with at least one encounter at the levels
// shown (an empty scene is no entry: with "Documented" Verdi is not listed) and, with a year chosen, an encounter in
// that year (yearPeople); those with a word starting with the query first ("ver" -> Verdi before Severini), then by
// name (the API order).
function searchPeople(people, query) {
  const wordStart = (person) => person.words.some((word) => word.startsWith(query));
  const ofTheYear = (person) => yearPeople === null || yearPeople.has(person.qid);
  const found = people.filter(
    (person) => person.folded.includes(query) && encounterCount(person) > 0 && ofTheYear(person),
  );
  return [...found.filter(wordStart), ...found.filter((person) => !wordStart(person))];
}

// The field and its list: typing filters, arrows move, Enter or a click opens the person, Escape gives the field back.
// Opening a person loads the page again with ?person=<QID> (the other parameters kept, ?year too): the scene is built
// once per page, and the address can be shared or bookmarked, the back button goes to the person before.
// The year (setupYears) filters the list: refreshSearch builds it again.
function setupSearch(entries) {
  const people = entries.people.map((person) => {
    const folded = fold(person.name);
    return { ...person, folded, words: folded.split(/\s+/) };
  });
  let shown = [];
  let active = 0;
  // The rows on screen, one per person of `shown`: the arrows move the class "active" between two of them, the list is
  // not built again.
  let rows = [];

  function close() {
    searchResults.hidden = true;
    shown = [];
    rows = [];
  }

  function open(person) {
    close();
    if (person.qid === PERSON_QID) {
      searchInput.value = searchedName;
      searchInput.blur();
      return;
    }
    const address = new URL(window.location.href);
    address.searchParams.set("person", person.qid);
    window.location.assign(address);
  }

  // The list again for what is in the name field (after a change of the name or of the year). Like a combo box: an empty
  // field, or the name of the scene still untouched, lists EVERY person (scrolling, the person of the scene active);
  // typing filters.
  function refresh() {
    if (document.activeElement !== searchInput) {
      close();
      return;
    }
    const value = searchInput.value.trim();
    const listAll = value.length === 0 || value === searchedName;
    shown = searchPeople(people, listAll ? "" : fold(value));
    const current = shown.findIndex((person) => person.qid === PERSON_QID);
    active = listAll && current >= 0 ? current : 0;
    render();
  }

  function render() {
    rows = shown.map((person, index) => {
      const item = makeElement("li", "search-result");
      item.classList.toggle("active", index === active);
      item.append(makeElement("span", "search-name", person.name));
      item.append(makeElement("span", "search-years", `${person.birth_year}-${person.last_year}`));
      // mousedown, not click: a click comes after the blur of the field, which closes the list.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        open(person);
      });
      return item;
    });
    const empty = yearPeopleMessage ?? (chosenYear === null ? NOBODY_FOUND : `${NOBODY_FOUND} in ${chosenYear}`);
    searchResults.replaceChildren(...(rows.length > 0 ? rows : [makeElement("li", "search-empty", empty)]));
    searchResults.hidden = false;
    rows[active]?.scrollIntoView({ block: "nearest" });
  }

  // Moves the highlight to another row, kept visible in the scrolling list.
  function setActive(index) {
    rows[active]?.classList.remove("active");
    active = index;
    rows[active].classList.add("active");
    rows[active].scrollIntoView({ block: "nearest" });
  }

  searchInput.addEventListener("input", refresh);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && shown.length > 0) {
      setActive((active + 1) % shown.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp" && shown.length > 0) {
      setActive((active - 1 + shown.length) % shown.length);
      event.preventDefault();
    } else if (event.key === "Enter" && shown.length > 0) {
      open(shown[active]);
    } else if (event.key === "Escape") {
      searchInput.blur();
    }
  });
  // On focus the whole name is selected (typing replaces it) and the whole list opens. On blur the field shows the
  // person of the scene again.
  searchInput.addEventListener("focus", () => {
    searchInput.select();
    refresh();
  });
  // The arrow of the combo: opens the whole list (focus), or closes it when open. mousedown, not click: the click
  // would come after the blur of the field.
  searchToggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (document.activeElement === searchInput) {
      searchInput.blur();
    } else {
      searchInput.focus();
    }
  });
  searchInput.addEventListener("blur", () => {
    close();
    searchInput.value = searchedName;
  });
  refreshSearch = refresh;
  if (YEAR_VIEW) {
    // The filter on one person of the year comes in the next step: for now the year view shows everybody.
    searchInput.placeholder = "All the people";
    return;
  }
  searchInput.placeholder = "Search a person";
  searchInput.disabled = false;
  searchToggle.disabled = false;
}

// --- Year -----------------------------------------------------------------------------------------------------------

const yearResults = document.getElementById("year-results");
const yearToggle = document.getElementById("year-toggle");
const NOBODY_FOUND = "Nobody found";
// The first row of the year list once a year is chosen: back to every person.
const ALL_YEARS = { year: null, count: null };
const ALL_YEARS_LABEL = "All years";
// The year chosen, or null: the year field shows it when nothing is being typed.
let chosenYear = START_YEAR;
// The QIDs of the people with an encounter in the year chosen, or null with no year (or while they load): the person
// list keeps only them (searchPeople).
let yearPeople = null;
// The message of the person list while the people of the year load, or when they could not be loaded; else null.
let yearPeopleMessage = null;
// Builds the person list again: set by setupSearch, null before /entries.
let refreshSearch = null;
// Counts the requests for the people of a year: an answer that is not the latest is dropped (years chosen quickly).
let yearRequest = 0;

// Years with encounters (src/api/years.py): {years: [{year, documented, plausible}, ...]}, asked once.
async function fetchYears() {
  const response = await apiFetch(`/years`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// The QIDs of the people with an encounter active in `year`, at the levels shown: the people of the year scene
// (GET /scene?year=, src/api/scene.py), the year alone (no window).
async function fetchYearPeople(year) {
  const parameters = new URLSearchParams({ year });
  for (const level of LEVELS) {
    parameters.append("level", level);
  }
  const response = await apiFetch(`/scene?${parameters}`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  const scene = await response.json();
  return new Set(scene.people.map((person) => person.qid));
}

// Loads the people of `year` (null: no filter) into yearPeople, then builds the person list again.
async function filterByYear(year) {
  yearRequest += 1;
  const request = yearRequest;
  yearPeople = null;
  yearPeopleMessage = null;
  if (year !== null) {
    // While loading: an empty list with a message, never the whole list (it would read as the people of that year).
    yearPeople = new Set();
    yearPeopleMessage = `Loading the people of ${year}...`;
    refreshSearch?.();
    try {
      const people = await fetchYearPeople(year);
      if (request !== yearRequest) {
        return;
      }
      yearPeople = people;
      yearPeopleMessage = null;
    } catch (error) {
      if (request !== yearRequest) {
        return;
      }
      console.error("People of the year:", error);
      // An empty filter with a message: the whole list would read as "everybody had an encounter that year".
      yearPeople = new Set();
      yearPeopleMessage = `The people of ${year} could not be loaded`;
    }
  }
  refreshSearch?.();
}

// A year chosen (null: all years): the field, the address (?year, no reload), the clock of the scene, the filter of the
// person list. Then the person field takes the focus, so the list of the people of that year opens at once.
function chooseYear(year) {
  chosenYear = year;
  searchYear.value = year ?? "";
  const address = new URL(window.location.href);
  address.searchParams.delete("year");
  // An old address may still carry a month (before the year view): it goes with the first change.
  address.searchParams.delete("month");
  if (year !== null) {
    address.searchParams.set("year", year);
    if (jumpToClock !== null) {
      // The clock is a fractional year: the year itself is its first day.
      jumpToClock(year);
    }
  }
  window.history.replaceState(null, "", address);
  if (YEAR_VIEW) {
    // The year view: the picture of the year, no clock and no person list to open (yet). Before the map is there the
    // year is only kept: startYearView draws it.
    if (year !== null && styleLoaded) {
      showYear(year);
    }
    return;
  }
  // The filter first (its loading state is set at once), then the focus, which opens the person list.
  filterByYear(year);
  if (!searchInput.disabled) {
    searchInput.focus();
  }
}

// "1 encounter", "6 encounters": encounters active in that year (one encounter counts in every year it lasts).
function encountersText(count) {
  return `${count} ${count === 1 ? "encounter" : "encounters"}`;
}

// The year combo: the years with at least one encounter at the levels shown, each with its count. The arrow or the
// field opens the list; typing keeps the years starting with what is typed ("18" -> the 1800s); arrows + Enter or a
// click choose. Enter on a typed year with no row (no encounter that year) takes it anyway: the person list then says
// nobody was found. Escape or leaving the field gives back the year chosen.
function setupYears(data) {
  const years = data.years
    .map((entry) => ({ year: entry.year, count: LEVELS.reduce((total, level) => total + (entry[level] ?? 0), 0) }))
    .filter((entry) => entry.count > 0);
  let shown = [];
  let active = 0;
  let rows = [];

  function close() {
    yearResults.hidden = true;
    shown = [];
    rows = [];
  }

  function pick(entry) {
    close();
    chooseYear(entry.year);
  }

  function refresh() {
    if (document.activeElement !== searchYear) {
      close();
      return;
    }
    const value = searchYear.value.trim();
    const listAll = value.length === 0 || value === String(chosenYear);
    const found = listAll ? years : years.filter((entry) => String(entry.year).startsWith(value));
    // "All years" only in the person view: the year view always shows one year.
    shown = listAll && chosenYear !== null && !YEAR_VIEW ? [ALL_YEARS, ...found] : found;
    const current = shown.findIndex((entry) => entry.year === chosenYear);
    active = listAll && current >= 0 ? current : 0;
    render();
  }

  function render() {
    rows = shown.map((entry, index) => {
      const item = makeElement("li", "search-result");
      item.classList.toggle("active", index === active);
      item.append(makeElement("span", "search-name", entry.year === null ? ALL_YEARS_LABEL : String(entry.year)));
      if (entry.count !== null) {
        item.append(makeElement("span", "search-years", encountersText(entry.count)));
      }
      // mousedown, not click: a click comes after the blur of the field, which closes the list.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(entry);
      });
      return item;
    });
    yearResults.replaceChildren(...(rows.length > 0 ? rows : [makeElement("li", "search-empty", "No encounters")]));
    yearResults.hidden = false;
    rows[active]?.scrollIntoView({ block: "nearest" });
  }

  function setActive(index) {
    rows[active]?.classList.remove("active");
    active = index;
    rows[active].classList.add("active");
    rows[active].scrollIntoView({ block: "nearest" });
  }

  searchYear.addEventListener("input", refresh);
  searchYear.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && shown.length > 0) {
      setActive((active + 1) % shown.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp" && shown.length > 0) {
      setActive((active - 1 + shown.length) % shown.length);
      event.preventDefault();
    } else if (event.key === "Enter") {
      const value = searchYear.value.trim();
      if (shown.length > 0) {
        pick(shown[active]);
      } else if (YEAR_PATTERN.test(value)) {
        pick({ year: Number(value) });
      }
    } else if (event.key === "Escape") {
      searchYear.blur();
    }
  });
  searchYear.addEventListener("focus", () => {
    searchYear.select();
    refresh();
  });
  searchYear.addEventListener("blur", () => {
    close();
    searchYear.value = chosenYear ?? "";
  });
  yearToggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (document.activeElement === searchYear) {
      searchYear.blur();
    } else {
      searchYear.focus();
    }
  });
  searchYear.value = chosenYear ?? "";
  searchYear.disabled = false;
  yearToggle.disabled = false;
}

// --- View flag ------------------------------------------------------------------------------------------------------

// The flag "Person | Year" in the search: the pressed button is the view of the page; the other loads the page again
// with that view (?view=year, or no parameter for the person view). Person and year in the address are kept.
function setupViewFlag() {
  const current = YEAR_VIEW ? VIEW_YEAR : "person";
  const buttons = { person: document.getElementById("view-person"), [VIEW_YEAR]: document.getElementById("view-year") };
  for (const [view, button] of Object.entries(buttons)) {
    button.setAttribute("aria-pressed", String(view === current));
    button.addEventListener("click", () => {
      if (view === current) {
        return;
      }
      const address = new URL(window.location.href);
      if (view === VIEW_YEAR) {
        address.searchParams.set("view", VIEW_YEAR);
      } else {
        address.searchParams.delete("view");
      }
      window.location.assign(address);
    });
  }
}
setupViewFlag();

// --- Year view ------------------------------------------------------------------------------------------------------

// The windows of years, the same as scene.SPANS of the API: the year alone, then blocks of 2, 5 and 10 years aligned
// on the calendar (1803 -> 1802-1803, 1800-1804, 1800-1809). The first window with an encounter is shown.
const SPANS = [1, 2, 5, 10];
// The camera on the places of a year never zooms in closer than a region: one place alone would fill the screen.
const YEAR_MAX_ZOOM = 6;
// The pair of names in the list: "Lagrange + Cuvier".
const PAIR_SEPARATOR = " + ";
// The levels from the strongest: a person present takes the colour of the strongest level of their pairs there.
const LEVEL_ORDER = ["documented", "plausible", "possible"];
// The labels of the places of the year shown (HTML Markers), removed when another year is drawn.
let yearLabels = [];
// Counts the years asked: an answer that is not the latest is dropped (years chosen quickly).
let yearShown = 0;
// The list of the year shown, kept to come back to it from the card of an encounter.
let yearList = null;
// The faces and leader lines of the encounter shown on the map (HTML Markers), removed when another one is shown.
let yearFaces = [];

// [first, last] of the window of `span` years holding `year`, aligned on the calendar.
function windowOf(year, span) {
  const first = year - (year % span);
  return [first, first + span - 1];
}

// The smallest span whose window holds a year with an encounter (`counts`: year -> encounters at the levels shown),
// null if even ten years have none.
function chooseSpan(year, counts) {
  const found = SPANS.find((span) => {
    const [first, last] = windowOf(year, span);
    for (let one = first; one <= last; one += 1) {
      if ((counts.get(one) ?? 0) > 0) {
        return true;
      }
    }
    return false;
  });
  return found ?? null;
}

// The scene of a window of years (GET /scene?year=&span=, src/api/scene.py): the encounters active in it.
async function fetchYearScene(year, span) {
  const parameters = new URLSearchParams({ year, span });
  for (const level of LEVELS) {
    parameters.append("level", level);
  }
  const response = await apiFetch(`/scene?${parameters}`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// The encounters of a year scene grouped by place: [{place, encounters: [{id, encounter, stayA, stayB, nameA, nameB,
// qidA, qidB}]}], the place with most encounters first, inside a place the strongest first (rank). The two stays of an
// encounter are at the same place, so the place of the first one is the place of the encounter.
function encountersByPlace(scene) {
  const stays = new Map(scene.stays.map((stay) => [stay.stay_id, stay]));
  const places = new Map(scene.places.map((place) => [place.qid, place]));
  const people = new Map(scene.people.map((person) => [person.qid, person]));
  const perPlace = new Map();
  for (const encounter of scene.encounters) {
    const stayA = stays.get(encounter.stay_a);
    const stayB = stays.get(encounter.stay_b);
    const list = perPlace.get(stayA.place) ?? [];
    list.push({
      id: `${encounter.stay_a}/${encounter.stay_b}`, encounter, stayA, stayB,
      qidA: stayA.person, qidB: stayB.person,
      nameA: people.get(stayA.person).name, nameB: people.get(stayB.person).name,
    });
    perPlace.set(stayA.place, list);
  }
  return [...perPlace]
    .map(([qid, list]) => ({
      place: places.get(qid),
      encounters: list.sort((one, two) => one.encounter.rank - two.encounter.rank),
    }))
    .sort((one, two) => two.encounters.length - one.encounters.length);
}

// The years both people were surely at the place: the common part of the two inner intervals ("1801-1803").
function commonYears(stayA, stayB) {
  const start = stayA.inner_start > stayB.inner_start ? stayA.inner_start : stayB.inner_start;
  const end = stayA.inner_end < stayB.inner_end ? stayA.inner_end : stayB.inner_end;
  return years(start, end);
}

// The names of the places of the year on the map, centred on their point (style.css, .year-place), then the camera
// frames them in the free part of the map. No circles: the encounters themselves are in the list.
function drawYearPlaceNames(groups) {
  clearYearFaces();
  for (const label of yearLabels) {
    label.remove();
  }
  yearLabels = groups.map(({ place }) => {
    const element = makeElement("div", "stop-label");
    element.append(makeElement("span", "year-place", place.name));
    return new Marker({ element }).setLngLat([place.lon, place.lat]).addTo(map);
  });
  if (groups.length > 0) {
    const points = groups.map(({ place }) => [place.lon, place.lat]);
    map.fitBounds(boundsOf(points), { padding: panelPadding(FIT_PADDING), maxZoom: YEAR_MAX_ZOOM });
  }
}

// The people present at one place of the year, each with the pairs they are in there: [{qid, name, level, pairs:
// [{item, otherQid, otherName}]}], the person who met most first, then by name. `level`: the strongest level of the
// pairs of that person there (the colour of its row and of its face when the whole place is shown).
function peopleOfPlace(group) {
  const people = new Map();
  const add = (qid, name, item, otherQid, otherName) => {
    const person = people.get(qid) ?? { qid, name, pairs: [] };
    person.pairs.push({ item, otherQid, otherName });
    people.set(qid, person);
  };
  for (const item of group.encounters) {
    add(item.qidA, item.nameA, item, item.qidB, item.nameB);
    add(item.qidB, item.nameB, item, item.qidA, item.nameA);
  }
  return [...people.values()]
    .map((person) => ({
      ...person,
      level: LEVEL_ORDER.find((level) => person.pairs.some(({ item }) => item.encounter.level === level)),
    }))
    .sort((one, two) => two.pairs.length - one.pairs.length || one.name.localeCompare(two.name));
}

// "met 5": the people a person met at that place.
function metText(count) {
  return `met ${count}`;
}

// The list of the year in the card panel, by PEOPLE PRESENT, not by pairs (6 people in Paris are 15 pairs; 20 would be
// 190): a title with the window, the statistics, then each place ("PARIS · 6 people") with the people who were there
// and how many they met. A click on a place shows all its people on the map; a click on a person shows that person on
// the place with the people met around, and opens under the row its pairs (other person, years, level); a click on a
// pair opens its sources. `selected` = {place, person} (QIDs, person null for the whole place); with none, the first
// place is chosen and shown, so a new year never opens on an empty map. `show` false: the map is left as it is (back
// from a card). The list keeps its scroll, and the row chosen is scrolled into view.
function showYearList(title, groups, stats, selected = null, show = true) {
  const chosen = selected ?? (groups.length > 0 ? { place: groups[0].place.qid, person: null } : null);
  const scroll = selected === null ? 0 : card.scrollTop;
  yearList = { title, groups, stats, selected: chosen };
  card.hidden = false;
  const select = (place, person) => showYearList(title, groups, stats, { place, person });
  let chosenRow = null;
  const sections = groups.map((group) => {
    const { place } = group;
    const people = peopleOfPlace(group);
    const placeChosen = chosen !== null && chosen.place === place.qid;
    const section = makeElement("section", "card-side");
    const head = makeElement("button", "year-place-head", `${place.name}${CREDIT_SEPARATOR}${people.length} people`);
    head.type = "button";
    head.title = "Show everybody at this place";
    head.classList.toggle("year-pair-selected", placeChosen && chosen.person === null);
    head.addEventListener("click", () => select(place.qid, null));
    section.append(head);
    if (placeChosen && chosen.person === null) {
      chosenRow = head;
    }
    for (const person of people) {
      const open = placeChosen && chosen.person === person.qid;
      const row = makeElement("button", "year-pair");
      row.type = "button";
      row.style.setProperty("--ring", ENCOUNTER_COLORS[person.level]);
      row.classList.toggle("year-pair-selected", open);
      row.append(
        makeElement("span", "year-pair-names", person.name),
        makeElement("span", "year-pair-meta", metText(person.pairs.length)),
      );
      // A second click on the open person goes back to the whole place.
      row.addEventListener("click", () => select(place.qid, open ? null : person.qid));
      section.append(row);
      if (open) {
        chosenRow = row;
        for (const { item, otherName } of person.pairs) {
          const pair = makeElement("button", "year-pair year-pair-sub");
          pair.type = "button";
          pair.title = "Open the sources";
          pair.style.setProperty("--ring", ENCOUNTER_COLORS[item.encounter.level]);
          pair.append(
            makeElement("span", "year-pair-names", `${PAIR_SEPARATOR.trim()} ${otherName}`),
            makeElement("span", "year-pair-meta", `${commonYears(item.stayA, item.stayB)}, ${item.encounter.level}`),
          );
          pair.addEventListener("click", () => showYearCard(item, place));
          section.append(pair);
        }
      }
    }
    return section;
  });
  cardBody.replaceChildren(makeElement("h2", "card-title", title), stats, ...sections);
  card.scrollTop = scroll;
  chosenRow?.scrollIntoView({ block: "nearest" });
  if (show && chosen !== null) {
    const group = groups.find((one) => one.place.qid === chosen.place);
    showPlaceOnMap(group, chosen.person, select);
  }
}

// How many times each value of `keys` appears, the most frequent first (ties by text): [[key, count], ...].
function ranking(keys) {
  const counts = new Map();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((one, two) => two[1] - one[1] || String(one[0]).localeCompare(String(two[0])));
}

// The encounters per year at the levels shown, from /years: year -> encounters active in it.
function countsAtLevels(data) {
  return new Map(data.years.map((entry) => [
    entry.year, LEVELS.reduce((total, level) => total + (entry[level] ?? 0), 0),
  ]));
}

// The year with most encounters active in it (the earliest on a tie): {year, count}, null with no encounter.
// Exact for a year; a decade cannot be told from these counts (an encounter counts once in every year it lasts).
function busiestYear(counts) {
  let best = null;
  for (const [year, count] of counts) {
    if (count > 0 && (best === null || count > best.count || (count === best.count && year < best.year))) {
      best = { year, count };
    }
  }
  return best;
}

// The statistics at the top of the list: the window shown (encounters, people, places), the place with most encounters,
// the person met most, and the busiest year of the whole corpus as a link to it (at the levels shown).
function yearStats(scene, groups, counts) {
  const box = makeElement("div", "year-stats");
  const line = (label, value) => {
    const row = makeElement("div", "year-stats-line");
    row.append(makeElement("span", "year-stats-label", label), value);
    box.append(row);
  };
  const people = scene.people.length;
  line("Here", `${encountersText(scene.encounters.length)}, ${people} ${people === 1 ? "person" : "people"}, `
    + `${groups.length} ${groups.length === 1 ? "place" : "places"}`);
  if (groups.length > 0) {
    line("Busiest place", `${groups[0].place.name} (${groups[0].encounters.length})`);
  }
  const names = new Map(scene.people.map((person) => [person.qid, person.name]));
  const met = ranking(groups.flatMap(({ encounters }) => encounters.flatMap((item) => [item.qidA, item.qidB])));
  if (met.length > 0) {
    line("Met most", `${names.get(met[0][0])} (${met[0][1]})`);
  }
  const best = busiestYear(counts);
  if (best !== null) {
    const link = makeElement("button", "year-stats-link", String(best.year));
    link.type = "button";
    link.title = `Show ${best.year}`;
    link.addEventListener("click", () => chooseYear(best.year));
    const value = makeElement("span", "");
    value.append(link, ` (${encountersText(best.count)})`);
    line("Busiest year", value);
  }
  return box;
}

// Removes the faces and leader lines of the year view from the map.
function clearYearFaces() {
  for (const marker of yearFaces) {
    marker.remove();
  }
  yearFaces = [];
}

// Shows the people of one place of the year on the map, as in the person view. With `personQid` null: everybody who was
// there, in rows above the place, each with a leader line to it, the ring of the strongest level of their pairs and
// "met N" under the name; a click on a face chooses that person. With a person: that person ON the place (the red ring
// of the person of a scene), the people met in rows above, each with the ring and line style of the level of the pair
// and under the name the level and the years both were there; a click on one of them opens the sources of the pair, a
// click on the person goes back to the whole place. The camera glides to the place, then pans so the faces are clear of
// the panels (keepSeatsOnScreen). `select(place, person)` updates the list and the map.
function showPlaceOnMap(group, personQid, select) {
  clearYearFaces();
  const { place } = group;
  const lngLat = [place.lon, place.lat];
  const people = peopleOfPlace(group);
  const person = people.find((one) => one.qid === personQid) ?? null;
  // Seated: [{qid, name, level, lines: [two short lines under the name], click}].
  const seated = person === null
    ? people.map((one) => ({
      qid: one.qid, name: one.name, level: one.level, lines: [one.level, metText(one.pairs.length)],
      click: () => select(place.qid, one.qid),
    }))
    : person.pairs.map(({ item, otherQid, otherName }) => ({
      qid: otherQid, name: otherName, level: item.encounter.level,
      lines: [item.encounter.level, commonYears(item.stayA, item.stayB)],
      click: () => showYearCard(item, place),
    }));
  // The leader lines first: a Marker added earlier lies under the later ones, so no line crosses a face or a label.
  const leaders = seated.map((one, index) => {
    const anchor = makeElement("div", `leader-anchor figure-met figure-${one.level}`);
    anchor.style.setProperty("--ring", ENCOUNTER_COLORS[one.level]);
    const line = makeElement("div", "figure-leader");
    anchor.append(line);
    pointLeader(line, seatOffset(index, seated.length));
    yearFaces.push(new Marker({ element: anchor }).setLngLat(lngLat).addTo(map));
    return anchor;
  });
  const faces = seated.map((one, index) => {
    const element = figureElement({ name: one.name }, portraitIndex[one.qid], ENCOUNTER_COLORS[one.level]);
    element.classList.add("figure-met", `figure-${one.level}`);
    const meta = makeElement("span", "figure-meta");
    meta.append(makeElement("span", "figure-level", one.lines[0]), makeElement("span", "figure-date", one.lines[1]));
    element.querySelector(".figure-name").append(meta);
    element.addEventListener("click", one.click);
    const offset = seatOffset(index, seated.length);
    yearFaces.push(new Marker({ element, offset }).setLngLat(lngLat).addTo(map));
    return { element, lngLat, offset, shown: true };
  });
  if (person !== null) {
    const own = figureElement({ name: person.name }, portraitIndex[person.qid], TRACK_COLOR);
    own.classList.add("figure-main");
    own.querySelector(".face").title = `${person.name}: back to everybody at ${place.name}`;
    own.addEventListener("click", () => select(place.qid, null));
    yearFaces.push(new Marker({ element: own }).setLngLat(lngLat).addTo(map));
  }
  // Shown on the next frame: the fade and the pulse start from the hidden state, as when a face appears in the
  // person view.
  requestAnimationFrame(() => {
    for (const element of [...leaders, ...faces.map((face) => face.element)]) {
      element.classList.add("figure-shown");
    }
  });
  // The faces are checked after the glide: measured before it, they would be in the old view.
  map.once("moveend", () => keepSeatsOnScreen(faces));
  map.easeTo({ center: lngLat, duration: CAMERA_JUMP_SECONDS * MILLISECONDS_PER_SECOND });
}

// The card of one encounter of the year: both people, the place, each side with its sources (cardSide, as in the person
// view), the licences, and a button back to the list. The side of a person is found by its stay.
async function showYearCard(item, place) {
  const back = makeElement("button", "notice-button", "← All the encounters"); // "←"
  back.type = "button";
  back.addEventListener("click", () => {
    showYearList(yearList.title, yearList.groups, yearList.stats, yearList.selected, false);
  });
  cardBody.replaceChildren(back, makeElement("p", "card-loading", "Loading the sources..."));
  try {
    const data = await fetchCard(item.id);
    const qidOf = (side) => (side.stay.stay_id === item.stayA.stay_id ? item.qidA : item.qidB);
    cardBody.replaceChildren(
      back,
      makeElement("h2", "card-title", NAME_LIST_FORMAT.format([item.nameA, item.nameB])),
      makeElement("div", "card-where", place.name),
      cardSide(data.side_a, qidOf(data.side_a), item.encounter.level),
      cardSide(data.side_b, qidOf(data.side_b), item.encounter.level),
      cardAttribution(),
    );
  } catch (error) {
    console.error("Card:", error);
    cardBody.replaceChildren(back, makeElement("p", "card-loading", "The sources could not be loaded (see the console)."));
  }
}

// "6 encounters in 1 place".
function yearSummary(encounters, places) {
  return `${encountersText(encounters)} in ${places} ${places === 1 ? "place" : "places"}`;
}

// The picture of one year: the window chosen from /years (the year alone, else 2, 5, 10 years), the scene of that
// window, the place names on the map and the list of the encounters. The time bar says which window is shown: "1803",
// or "1800-1804" with "No encounters in 1803" (the window is always written on screen, spec.md "Year view").
async function showYear(year) {
  yearShown += 1;
  const request = yearShown;
  document.title = `${year}${TITLE_SEPARATOR}${SITE_NAME}`;
  clockDate.textContent = String(year);
  clockPlace.textContent = "Loading...";
  try {
    const counts = countsAtLevels(await yearsReady);
    const span = chooseSpan(year, counts);
    if (span === null) {
      if (request === yearShown) {
        const [first, last] = windowOf(year, SPANS[SPANS.length - 1]);
        drawYearPlaceNames([]);
        card.hidden = true;
        clockPlace.textContent = `No encounters in ${first}-${last}`;
      }
      return;
    }
    const scene = await fetchYearScene(year, span);
    if (request !== yearShown) {
      return;
    }
    const groups = encountersByPlace(scene);
    drawYearPlaceNames(groups);
    const summary = yearSummary(scene.encounters.length, groups.length);
    const windowText = span === 1 ? String(year) : `${scene.window.first}-${scene.window.last}`;
    clockDate.textContent = windowText;
    clockPlace.textContent = span === 1 ? summary : `No encounters in ${year}${CREDIT_SEPARATOR}${summary}`;
    showYearList(`Encounters in ${windowText}`, groups, yearStats(scene, groups, counts));
    console.log(`year ${year}: span ${span}, ${summary}`);
  } catch (error) {
    if (request !== yearShown) {
      return;
    }
    console.error("Year scene:", error);
    clockPlace.textContent = "";
    showLoadError("data", error instanceof TypeError);
  }
}

// The year view starts when the map is there: the year of the address, or the busiest year.
// The controls of the person view (buttons, track) are hidden by style.css.
function startYearView() {
  document.body.classList.add("year-view");
  timebar.classList.remove("loading");
  // The portraits for the faces of the encounters (fetchPortraits never fails: no index, initials).
  fetchPortraits().then((portraits) => {
    portraitIndex = portraits;
  });
  if (chosenYear !== null) {
    showYear(chosenYear);
    return;
  }
  // No year in the address: the busiest year, so the view never opens on an empty map.
  clockDate.textContent = "Loading...";
  clockPlace.textContent = "";
  yearsReady.then((data) => {
    const best = busiestYear(countsAtLevels(data));
    if (best !== null) {
      chooseYear(best.year);
    }
  }).catch(() => {});
}

// --- Levels ---------------------------------------------------------------------------------------------------------

// The selector of the levels in the time bar. A choice loads the page again with ?level=<choice> (the other parameters
// kept), like the search: the scene is built once per page. The default choice leaves the address clean.
function openLevelChoice(choice) {
  const address = new URL(window.location.href);
  if (choice === DEFAULT_LEVEL_CHOICE) {
    address.searchParams.delete("level");
  } else {
    address.searchParams.set("level", choice);
  }
  window.location.assign(address);
}

function setupLevels() {
  const levelSelect = document.getElementById("level");
  const options = Object.entries(LEVEL_CHOICES).map(([choice, { label }]) => {
    const option = makeElement("option", "", label);
    option.value = choice;
    return option;
  });
  levelSelect.replaceChildren(...options);
  levelSelect.value = LEVEL_CHOICE;
  levelSelect.addEventListener("change", () => openLevelChoice(levelSelect.value));
  levelSelect.disabled = false;
}
setupLevels();

// A scene with nothing to see at the levels chosen: no encounter at all (Verdi with "Documented"), or `hidden`
// encounters that never come on screen (Agatha Christie before the stop order of schedule: her window fell while she
// was elsewhere). A notice in the middle of the map pauses the clock and offers a choice. "Continue" closes it and plays
// the journeys of the person anyway; each other level choice where the person HAS encounters (counts of /entries) opens
// the same person with that choice. Without /entries only "Continue" is offered.
function showEmptyNotice(person, hidden) {
  const notice = document.getElementById("notice");
  const body = document.getElementById("notice-body");
  const buttons = document.getElementById("notice-buttons");
  const label = LEVEL_CHOICE === "all" ? "" : `${LEVEL_CHOICES[LEVEL_CHOICE].label.toLowerCase()} `;
  const text = hidden === 0
    ? `No ${label}encounters for ${person.name}.`
    : `${hidden} ${label}${hidden === 1 ? "encounter" : "encounters"} for ${person.name}, not on the track.`;
  const hint = hidden === 0
    ? "Continue to see the journeys only, or show other encounters."
    : "The dates fall while the journey is elsewhere. Continue to see the journeys only, or show other encounters.";
  body.replaceChildren(makeElement("p", "notice-text", text), makeElement("p", "notice-hint", hint));
  // Continue: the journeys only (the box turned on), since there is no meeting to jump to.
  const close = () => {
    notice.hidden = true;
    showJourneys();
    playClock(true);
  };
  const continueButton = makeElement("button", "notice-button notice-continue", "Continue");
  continueButton.type = "button";
  continueButton.addEventListener("click", close);
  buttons.replaceChildren(continueButton);
  playClock(false);
  notice.hidden = false;
  entriesReady.then((entries) => {
    const entry = entries.people.find((one) => one.qid === person.qid);
    if (entry === undefined) {
      return;
    }
    const suggestions = Object.entries(LEVEL_CHOICES)
      .map(([choice, { levels, label: choiceLabel }]) => ({
        choice,
        choiceLabel,
        count: levels.reduce((total, level) => total + (entry[level] ?? 0), 0),
      }))
      .filter(({ choice, count }) => choice !== LEVEL_CHOICE && count > 0)
      .map(({ choice, choiceLabel, count }) => {
        const button = makeElement("button", "notice-button", `${choiceLabel} (${count})`);
        button.type = "button";
        button.addEventListener("click", () => openLevelChoice(choice));
        return button;
      });
    buttons.prepend(...suggestions);
  }).catch(() => {});
}

// The map or the scene could not be loaded: the same notice as an empty scene, with the reason and a "Reload" button,
// instead of a striped bar and nothing else. `what` names what is missing ("map", "data"). `blocked`: the request
// never got an answer: a blocker (seen 2026-11-15 with NoScript on *.azurecontainerapps.io and tiles.openfreemap.org;
// ad block lists may block the shared Azure domain too) or no network; otherwise the API answered with an error status.
function showLoadError(what, blocked) {
  const notice = document.getElementById("notice");
  const text = blocked ? `The ${what} of MeeTime could not be reached.` : `The server of MeeTime answered with an error.`;
  const hint = blocked
    ? "An ad blocker or a script blocker (such as NoScript) may block it: allow this site, then reload. Or check the connection."
    : "Try again in a minute.";
  document.getElementById("notice-body").replaceChildren(
    makeElement("p", "notice-text", text),
    makeElement("p", "notice-hint", hint),
  );
  const reload = makeElement("button", "notice-button notice-continue", "Reload");
  reload.type = "button";
  reload.addEventListener("click", () => window.location.reload());
  document.getElementById("notice-buttons").replaceChildren(reload);
  notice.hidden = false;
}

// Asks before opening `url` in a new tab, in the notice panel ("Open the Wikipedia article of X?", Open / Cancel), not
// with the browser's confirm(): that dialog blocks the page and the animation. The clock pauses while asking and plays
// again after the answer if it was playing.
function askToOpen(what, url) {
  const notice = document.getElementById("notice");
  const wasPlaying = clockIsPlaying !== null && clockIsPlaying();
  if (playClock !== null) {
    playClock(false);
  }
  const answer = (open) => {
    notice.hidden = true;
    if (open) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    if (wasPlaying) {
      playClock(true);
    }
  };
  document.getElementById("notice-body").replaceChildren(
    makeElement("p", "notice-text", `Open ${what}?`),
    makeElement("p", "notice-hint", "It opens in a new tab."),
  );
  const cancel = makeElement("button", "notice-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => answer(false));
  const open = makeElement("button", "notice-button notice-continue", "Open");
  open.type = "button";
  open.addEventListener("click", () => answer(true));
  document.getElementById("notice-buttons").replaceChildren(cancel, open);
  notice.hidden = false;
}

// The legend under the time bar: one ring per level, in its colour and line (solid, dashed, dotted, as the faces), the
// levels not shown dimmed. The colours come from ENCOUNTER_COLORS, the one place for them.
function setupLegend() {
  const items = LEGEND.map(({ level, label }) => {
    const item = makeElement("span", "legend-item");
    item.classList.toggle("legend-off", !LEVELS.includes(level));
    if (!Object.values(LEVEL_CHOICES).some((choice) => choice.levels.includes(level))) {
      item.title = NOT_LOADED_TITLE;
    }
    const ring = makeElement("span", `legend-ring legend-ring-${level}`);
    ring.style.setProperty("--ring", ENCOUNTER_COLORS[level]);
    item.append(ring, makeElement("span", "legend-label", label));
    return item;
  });
  document.getElementById("legend").replaceChildren(...items);
}
setupLegend();

// The scene does not wait for the map either: asked at once, so a blocked API shows its notice even when the map never
// loads; drawn when the map is there. A fetch that never reaches the API throws a TypeError ("NetworkError" in Firefox,
// "Failed to fetch" in Chrome); an error status is a plain Error (fetchPersonScene).
const sceneReady = YEAR_VIEW ? null : Promise.all([fetchPersonScene(PERSON_QID, LEVELS), fetchPortraits()]);
sceneReady?.catch((error) => {
  console.error("Person scene:", error);
  timebar.classList.remove("loading");
  clockDate.textContent = "The scene could not be loaded";
  showLoadError("data", error instanceof TypeError);
});

// The list of the people does not wait for the map: it comes with the page.
// Asked once; the search and the note of an empty scene (the counts of the person per level) both read it.
const entriesReady = fetchEntries();
entriesReady.then(setupSearch).catch((error) => {
  console.error("Entries:", error);
  searchInput.placeholder = "The search could not be loaded";
});

// The years with encounters come with the page too, for the year combo. A year in the address filters the person list
// from the start.
const yearsReady = fetchYears();
yearsReady.then(setupYears).catch((error) => {
  console.error("Years:", error);
  searchYear.placeholder = "No years";
});
if (START_YEAR !== null && !YEAR_VIEW) {
  filterByYear(START_YEAR);
}

// The style must be loaded before sources and layers can be added.
map.on("load", async () => {
  if (!SHOW_MODERN_MAP) {
    hideModernLayers();
  }
  styleLoaded = true;
  if (YEAR_VIEW) {
    startYearView();
    return;
  }
  // The download and the drawing apart: a bug in the drawing can throw a TypeError too, and must not read as an ad
  // blocker in the notice. A failed download is already reported (sceneReady.catch).
  let scene;
  let portraits;
  try {
    [scene, portraits] = await sceneReady;
  } catch {
    return;
  }
  portraitIndex = portraits;
  timebar.classList.remove("loading");
  try {
    drawPersonScene(scene, PERSON_QID, portraits);
  } catch (error) {
    console.error("Person scene:", error);
    clockDate.textContent = "The scene could not be drawn (see the console)";
  }
});
