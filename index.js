// Subsonic: a source for Subsonic-compatible music servers, such as
// Navidrome, Airsonic, Gonic, Supysonic and Subsonic itself.
//
// Everything is asked for over the Subsonic REST API, signed with a token:
// md5(password + salt), which is what the server's u/t/s parameters are. The
// password itself never goes on the wire, and neither do the songs: the app
// plays them from the server's stream endpoint.

const PAGE = 50; // one page of search results, liked songs, and so on
const LIST = 500; // how much of a list a Browse page shows
const COVER = 600; // the side of a cover asked for, in pixels
const API_VERSION = "1.16.1"; // what OpenSubsonic servers speak
const CLIENT = "mygo-music";

const t = (text) => host.t(text);

// Settings, as the listener filled them in.
const setting = (key) => {
  const v = host.setting(key);
  return typeof v === "string" ? v : "";
};
const serverURL = () => setting("server").trim();
const username = () => setting("username").trim();
const password = () => setting("password");
const configured = () => serverURL() !== "" && username() !== "" && password() !== "";

// Both the errors the app acts on by their code, and plain ones.
function fail(code, message) {
  const e = new Error(message || "The server didn't answer.");
  if (code) e.code = code;
  return e;
}
const setupNeeded = () =>
  fail("setup", t("Fill in the server, username and password in the plugin's settings."));

function baseURL() {
  let raw = serverURL();
  if (raw === "") throw setupNeeded();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "http://" + raw;
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    throw fail("setup", t("The server address isn't a URL."));
  }
  let path = u.pathname.replace(/\/+$/, "");
  if (/\/rest$/i.test(path)) path = path.slice(0, -5);
  return u.origin + path;
}

// A salt of this run's own keeps a cover's URL the same all run, so the app
// fetches and keeps each cover once.
let saltValue = "";
function salt() {
  if (saltValue === "") {
    saltValue = host.crypto.md5(String(Date.now()) + ":" + String(Math.random())).slice(0, 16);
  }
  return saltValue;
}

function authParams() {
  return {
    u: username(),
    t: host.crypto.md5(password() + salt()),
    s: salt(),
    v: API_VERSION,
    c: CLIENT,
    f: "json",
  };
}

// qs makes a query of params, a list being a parameter to each.
function qs(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(item)));
    }
  }
  return parts.join("&");
}

// A refused request: wrong credentials send the listener to the settings,
// which is where they are; a missing song or album is unavailable.
function refused(error) {
  const code = Number(error && error.code) || 0;
  const message = (error && error.message) || t("The server refused the request.");
  // 40 wrong user or password, 41–44 authentication, 50 not authorized
  if (code === 40 || code === 41 || code === 42 || code === 43 || code === 44 || code === 50) {
    return fail("setup", message);
  }
  if (code === 70) return fail("unavailable", message);
  return fail("", message);
}

async function call(method, params, options) {
  if (!configured()) throw setupNeeded();
  const post = !!(options && options.post);
  const all = Object.assign(authParams(), params || {});
  const url = baseURL() + "/rest/" + method;
  let res;
  try {
    if (post) {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: qs(all),
      });
    } else {
      res = await fetch(url + "?" + qs(all));
    }
  } catch (e) {
    throw fail("", t("Couldn't reach the server.") + " " + (e && e.message ? e.message : String(e)));
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw fail("", method + ": " + res.status + " " + (res.statusText || ""));
  }
  const answer = body["subsonic-response"] || body;
  if (!answer || answer.status !== "ok" || answer.error) {
    throw refused(answer && answer.error);
  }
  return answer;
}

// The cover is fetched by the app itself, so its URL carries the same token
// the request would.
function coverURL(id, size) {
  if (!id) return "";
  return (
    baseURL() +
    "/rest/getCoverArt?" +
    qs(Object.assign(authParams(), { id: id, size: size || COVER }))
  );
}

// An image URL a server answered, made to carry the token if it's the
// server's own, and left as it is if it's somewhere else.
function authedImage(raw) {
  if (!raw) return "";
  let u;
  try {
    u = new URL(raw, baseURL() + "/");
  } catch (e) {
    return raw;
  }
  let base;
  try {
    base = new URL(baseURL());
  } catch (e) {
    return raw;
  }
  if (u.host !== base.host) return raw;
  if (/(?:^|[?&])u=/.test(raw)) return u.toString();
  return u.toString() + (u.search ? "&" : "?") + qs(authParams());
}

// A song's raw answer is kept for what playing it needs: its format, size and
// replay gain, which its row doesn't show.
const songs = new Map();
const SONG_CACHE = 5000;
function remember(raw) {
  if (!raw || !raw.id) return;
  if (songs.size >= SONG_CACHE) {
    const first = songs.keys().next();
    if (!first.done) songs.delete(first.value);
  }
  songs.set(raw.id, raw);
}

function artistList(raw) {
  const out = [];
  if (raw && Array.isArray(raw.artists)) {
    for (const a of raw.artists) {
      if (a && a.name) out.push({ id: a.id || "", name: a.name });
    }
  }
  if (out.length === 0 && raw && raw.artist) {
    out.push({ id: raw.artistId || "", name: raw.artist });
  }
  return out;
}

function imageOf(raw) {
  if (!raw) return "";
  if (raw.artistImageUrl) return authedImage(raw.artistImageUrl);
  if (raw.coverArt) return coverURL(raw.coverArt);
  return "";
}

function asTrack(raw) {
  remember(raw);
  const artists = artistList(raw);
  const albumID = raw.albumId || raw.parent || "";
  // A song's date comes the same way an album's does, as a string the app
  // takes: never the {year, month, day} an OpenSubsonic server may answer.
  const release = releasedOf(raw);
  return {
    id: raw.id,
    name: raw.title || raw.name || "",
    artists: artists,
    album: {
      id: albumID,
      name: raw.album || "",
      artists: artists,
      imageUrl: coverURL(raw.coverArt || albumID),
      released: release,
    },
    duration: Math.round((Number(raw.duration) || 0) * 1000),
  };
}

// OpenSubsonic gives a release date as {year, month, day}, and older servers
// as a year, while the app wants a string such as 2024-03-01.
function dateString(date) {
  if (!date) return "";
  if (typeof date === "string") return date;
  if (typeof date === "number") return String(date);
  if (typeof date !== "object") return "";
  const year = Number(date.year);
  if (!year) return "";
  let out = String(year);
  const month = Number(date.month);
  if (month > 0) {
    out += "-" + (month < 10 ? "0" : "") + month;
    const day = Number(date.day);
    if (day > 0) out += "-" + (day < 10 ? "0" : "") + day;
  }
  return out;
}

function releasedOf(raw) {
  return (
    dateString(raw.originalReleaseDate) ||
    dateString(raw.releaseDate) ||
    dateString(raw.year)
  );
}

function asAlbum(raw) {
  const a = {
    id: raw.id,
    name: raw.name || raw.album || raw.title || "",
    artists: artistList(raw),
    imageUrl: coverURL(raw.coverArt || raw.id),
    released: releasedOf(raw),
  };
  if (raw.starred) a.saved = true;
  return a;
}

function asArtist(raw) {
  return {
    id: raw.id,
    name: raw.name || "",
    imageUrl: imageOf(raw),
  };
}

function asPlaylist(raw, withTracks) {
  const p = {
    id: raw.id,
    name: raw.name || "",
    imageUrl: raw.coverArt ? coverURL(raw.coverArt) : "",
    description: raw.comment || "",
    owner: raw.owner || "",
    trackCount:
      raw.songCount === undefined || raw.songCount === null
        ? (raw.entry || []).length
        : Number(raw.songCount),
    mine: !raw.owner || raw.owner.toLowerCase() === username().toLowerCase(),
    tracks: undefined,
  };
  if (withTracks) {
    const entries = (raw.entry || []).filter((e) => e && e.id && !e.isDir);
    p.tracks = entries.map(asTrack);
    p.trackCount = p.tracks.length;
  }
  return p;
}

// Liked songs and albums are the server's starred ones. One list answers every
// heart on screen, and the lists age as the app's own do.
let starred = null;
const STARRED_FRESH = 15 * 1000;
async function starredNow(force) {
  if (!force && starred && Date.now() - starred.at < STARRED_FRESH) return starred;
  const answer = await call("getStarred2", {});
  const list = answer.starred2 || answer.starred || {};
  starred = {
    at: Date.now(),
    songs: list.song || [],
    albums: list.album || [],
  };
  return starred;
}
function forgetStarred() {
  starred = null;
}

const shuffled = (items) => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const at = out[i];
    out[i] = out[j];
    out[j] = at;
  }
  return out;
};

// ---------------------------------------------------------------------------
// Account

// Subsonic has no session to end, so signing out is this app forgetting who
// is signed in: it's kept here until they sign in again, or fill the settings
// in anew.
const SIGNED_OUT = "signedOut";
const signedOut = () => host.storage.get(SIGNED_OUT) === true;
function setSignedOut(on) {
  if (on) host.storage.set(SIGNED_OUT, true);
  else host.storage.remove(SIGNED_OUT);
}

export function account() {
  if (!configured() || signedOut()) return null;
  return { id: username(), name: username() };
}

export async function signIn() {
  if (!configured()) throw setupNeeded();
  // getUser asks about an account by its name, which is another parameter than
  // the u that signs every request: without it, Navidrome and the rest refuse
  // it as "missing parameter: 'username'".
  const answer = await call("getUser", { username: username() });
  setSignedOut(false);
  const user = answer.user || {};
  return {
    id: user.username || username(),
    name: user.username || username(),
  };
}

// What the app forgets as the listener signs out: who they are, and what was
// answered for them.
export function signOut() {
  setSignedOut(true);
  forgetStarred();
  songs.clear();
}

// A setting changed: what was answered with the old one goes, and credentials
// filled in anew are signed in with as they are.
export function setSetting({ key }) {
  if (key === "server" || key === "username" || key === "password") {
    setSignedOut(false);
    forgetStarred();
    songs.clear();
  }
}

// ---------------------------------------------------------------------------
// Home and pages of the plugin's own

// A promise's answer, or null if it failed. A source that isn't set up, or
// whose credentials are wrong, says so rather than making an empty page.
const settled = (promise) =>
  Promise.resolve(promise).then(
    (value) => ({ ok: true, value: value }),
    (error) => ({ ok: false, error: error }),
  );
function valueOf(result) {
  if (!result.ok) {
    if (result.error && (result.error.code === "setup" || result.error.code === "signIn")) {
      throw result.error;
    }
    return null;
  }
  return result.value;
}

function latestAlbums(answer) {
  return answer ? answer.albumList2 && answer.albumList2.album ? answer.albumList2.album.map(asAlbum) : [] : [];
}

export async function home() {
  if (!configured()) throw setupNeeded();
  // The card that leads Home has to be there, so its request is the one that
  // says when the server can't be reached at all.
  const random = await call("getRandomSongs", { size: 20 });
  const picked = random.randomSongs && random.randomSongs.song ? random.randomSongs.song : [];

  const results = await Promise.all([
    settled(call("getAlbumList2", { type: "newest", size: 12 })),
    settled(call("getAlbumList2", { type: "recent", size: 12 })),
    settled(call("getAlbumList2", { type: "frequent", size: 12 })),
    settled(starredNow(false)),
    settled(call("getArtists", {})),
    settled(call("getPlaylists", {})),
    settled(call("getGenres", {})),
  ]);

  const newest = latestAlbums(valueOf(results[0]));
  const recent = latestAlbums(valueOf(results[1]));
  const frequent = latestAlbums(valueOf(results[2]));
  const stars = valueOf(results[3]);
  const artistAnswer = valueOf(results[4]);
  const playlistAnswer = valueOf(results[5]);
  const genreAnswer = valueOf(results[6]);

  const sections = [];
  sections.push({
    title: t("Picked for You"),
    pageTitle: t("Picked for You"),
    subtitle: t("A fresh mix from your library"),
    tracks: picked.map(asTrack),
    empty: t("Your library has no songs yet"),
  });
  const pushAlbums = (title, items, page) => {
    if (items.length === 0) return;
    sections.push({ title: t(title), albums: items, morePage: page });
  };
  pushAlbums("Recently Added", newest, "albums-newest");
  pushAlbums("Recently Played", recent, "albums-recent");
  pushAlbums("Most Played", frequent, "albums-frequent");
  pushAlbums("Starred Albums", stars ? stars.albums.slice(0, 12).map(asAlbum) : [], "albums-starred");

  const artists = artistListOf(artistAnswer);
  if (artists.length > 0) {
    sections.push({ title: t("Artists"), artists: artists.slice(0, 12), morePage: "artists" });
  }
  const pls = playlistListOf(playlistAnswer);
  if (pls.length > 0) {
    sections.push({
      title: t("Playlists"),
      playlists: pls.slice(0, 12).map((p) => asPlaylist(p, false)),
      morePage: "playlists",
    });
  }
  const genres = genreListOf(genreAnswer);
  if (genres.length > 0) {
    sections.push({
      title: t("Genres"),
      links: genres.slice(0, 12).map((g) => ({
        title: g.value,
        subtitle: t("%d albums").replace("%d", String(g.albumCount || 0)),
        page: "genre:" + g.value,
      })),
      morePage: "genres",
    });
  }

  return { title: t("Home"), sections: sections };
}

function artistListOf(answer) {
  if (!answer || !answer.artists || !Array.isArray(answer.artists.index)) return [];
  const out = [];
  for (const group of answer.artists.index) {
    for (const a of group.artist || []) {
      if (a && a.name) out.push(asArtist(a));
    }
  }
  return out;
}

function playlistListOf(answer) {
  if (!answer || !answer.playlists || !Array.isArray(answer.playlists.playlist)) return [];
  return answer.playlists.playlist;
}

function genreListOf(answer) {
  if (!answer || !answer.genres || !Array.isArray(answer.genres.genre)) return [];
  return answer.genres.genre.filter((g) => g && g.value);
}

const ALBUM_PAGES = {
  "albums-all": { type: "alphabeticalByName", title: "All Albums" },
  "albums-newest": { type: "newest", title: "Recently Added" },
  "albums-recent": { type: "recent", title: "Recently Played" },
  "albums-frequent": { type: "frequent", title: "Most Played" },
  "albums-random": { type: "random", title: "Random Albums" },
};

export async function browse({ page }) {
  if (!configured()) throw setupNeeded();

  if (page === "artists") {
    const answer = await call("getArtists", {});
    const artists = artistListOf(answer);
    return {
      title: t("Artists"),
      sections: [
        {
          artists: artists,
          empty: t("No artists yet"),
        },
      ],
    };
  }

  if (page === "playlists") {
    const answer = await call("getPlaylists", {});
    const pls = playlistListOf(answer);
    return {
      title: t("Playlists"),
      sections: [{ playlists: pls.map((p) => asPlaylist(p, false)), empty: t("No playlists yet") }],
    };
  }

  if (page === "genres") {
    const answer = await call("getGenres", {});
    const genres = genreListOf(answer);
    return {
      title: t("Genres"),
      sections: [
        {
          links: genres.map((g) => ({
            title: g.value,
            subtitle: t("%d albums").replace("%d", String(g.albumCount || 0)),
            page: "genre:" + g.value,
          })),
          empty: t("No genres yet"),
        },
      ],
    };
  }

  if (page === "random") {
    const answer = await call("getRandomSongs", { size: 100 });
    const list = answer.randomSongs && answer.randomSongs.song ? answer.randomSongs.song : [];
    return {
      title: t("Random"),
      subtitle: t("A shuffle of everything on the server"),
      sections: [{ tracks: list.map(asTrack), empty: t("Your library has no songs yet") }],
    };
  }

  if (page === "albums-starred") {
    const star = await starredNow(false);
    return {
      title: t("Starred Albums"),
      sections: [{ albums: star.albums.map(asAlbum), empty: t("Nothing starred yet") }],
    };
  }

  if (page.indexOf("albums-") === 0) {
    const known = ALBUM_PAGES[page];
    if (!known) throw fail("unavailable", t("No such page."));
    if (known.type === "random") {
      const answer = await call("getAlbumList2", { type: "random", size: LIST });
      return {
        title: t(known.title),
        sections: [{ albums: latestAlbums(answer), empty: t("No albums yet") }],
      };
    }
    const answer = await call("getAlbumList2", { type: known.type, size: LIST });
    return {
      title: t(known.title),
      sections: [{ albums: latestAlbums(answer), empty: t("No albums yet") }],
    };
  }

  if (page.indexOf("genre:") === 0) {
    const genre = page.slice(6);
    if (!genre) throw fail("unavailable", t("No such page."));
    const results = await Promise.all([
      settled(call("getSongsByGenre", { genre: genre, count: 200 })),
      settled(call("getAlbumList2", { type: "byGenre", genre: genre, size: LIST })),
    ]);
    const trackAnswer = valueOf(results[0]);
    const albumAnswer = valueOf(results[1]);
    const list =
      trackAnswer && trackAnswer.songsByGenre && trackAnswer.songsByGenre.song
        ? trackAnswer.songsByGenre.song
        : [];
    return {
      title: genre,
      sections: [
        { tracks: list.map(asTrack), empty: t("No songs in this genre") },
        { albums: latestAlbums(albumAnswer), empty: t("No albums in this genre") },
      ],
    };
  }

  throw fail("unavailable", t("No such page."));
}

// ---------------------------------------------------------------------------
// Search

export async function search({ query, kind, offset }) {
  if (!configured()) throw setupNeeded();
  const at = Number(offset) || 0;

  if (kind === "playlists") {
    const answer = await call("getPlaylists", {});
    const q = String(query || "").toLowerCase();
    const found = playlistListOf(answer)
      .filter((p) => (p.name || "").toLowerCase().indexOf(q) >= 0)
      .map((p) => asPlaylist(p, false));
    return {
      playlists: found.slice(at, at + PAGE),
      more: found.length > at + PAGE,
    };
  }
  if (kind === "shows") {
    return { shows: [], more: false };
  }

  const params = {
    query: query,
    artistCount: kind === "artists" ? PAGE : 0,
    artistOffset: kind === "artists" ? at : 0,
    albumCount: kind === "albums" ? PAGE : 0,
    albumOffset: kind === "albums" ? at : 0,
    songCount: kind === "tracks" ? PAGE : 0,
    songOffset: kind === "tracks" ? at : 0,
  };
  // A server that needs two letters to search would rather not be asked.
  if (String(query || "").trim() === "") {
    return kind === "tracks"
      ? { tracks: [], more: false }
      : kind === "albums"
        ? { albums: [], more: false }
        : { artists: [], more: false };
  }
  const answer = await call("search3", params);
  const r = answer.searchResult3 || answer.searchResult2 || {};
  if (kind === "artists") {
    const found = (r.artist || []).map(asArtist);
    return { artists: found, more: found.length >= PAGE };
  }
  if (kind === "albums") {
    const found = (r.album || []).map(asAlbum);
    return { albums: found, more: found.length >= PAGE };
  }
  const found = (r.song || []).map(asTrack);
  return { tracks: found, more: found.length >= PAGE };
}

export async function suggest({ query }) {
  const q = String(query || "").trim();
  if (q === "" || !configured()) return [];
  let answer;
  try {
    answer = await call("search3", {
      query: q,
      artistCount: 0,
      albumCount: 0,
      songCount: 8,
    });
  } catch (e) {
    if (e && (e.code === "setup" || e.code === "signIn")) throw e;
    return [];
  }
  const r = answer.searchResult3 || {};
  const seen = {};
  const out = [];
  for (const song of r.song || []) {
    const name = song.title || song.name;
    if (name && !seen[name]) {
      seen[name] = true;
      out.push(name);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Albums, artists and stars

export async function album({ id }) {
  const answer = await call("getAlbum", { id: id });
  const raw = answer.album || {};
  return {
    album: asAlbum(raw),
    tracks: (raw.song || []).map(asTrack),
  };
}

export async function artist({ id }) {
  const answer = await call("getArtist", { id: id });
  const raw = answer.artist || {};
  const name = raw.name || "";
  const results = await Promise.all([
    settled(name ? call("getTopSongs", { artist: name, count: 20 }) : Promise.resolve(null)),
    settled(call("getArtistInfo2", { id: id })),
  ]);
  const top = valueOf(results[0]);
  const info = valueOf(results[1]);
  const topSongs = top && top.topSongs && top.topSongs.song ? top.topSongs.song : [];
  const infoObject = (info && info.artistInfo2) || {};
  const a = {
    id: raw.id || id,
    name: name,
    imageUrl: authedImage(infoObject.largeImageUrl || infoObject.mediumImageUrl) || imageOf(raw),
  };
  return {
    artist: a,
    tracks: topSongs.map(asTrack),
    albums: (raw.album || []).map(asAlbum),
  };
}

export async function like({ id, on }) {
  await call(on ? "star" : "unstar", { id: id }, { post: true });
  forgetStarred();
}

export async function isLiked({ ids }) {
  const list = Array.isArray(ids) ? ids : [];
  const star = await starredNow(false);
  const liked = {};
  for (const id of list) liked[id] = false;
  for (const song of star.songs) {
    if (song && song.id && liked[song.id] !== undefined) liked[song.id] = true;
  }
  return liked;
}

export async function liked({ offset }) {
  const star = await starredNow(false);
  const at = Number(offset) || 0;
  const page = star.songs.slice(at, at + PAGE);
  return {
    tracks: page.map(asTrack),
    more: at + PAGE < star.songs.length,
  };
}

export async function saveAlbum({ id, on }) {
  await call(on ? "star" : "unstar", { albumId: id }, { post: true });
  forgetStarred();
}

export async function savedAlbums({ offset }) {
  const star = await starredNow(false);
  const at = Number(offset) || 0;
  const page = star.albums.slice(at, at + PAGE);
  return {
    albums: page.map(asAlbum),
    more: at + PAGE < star.albums.length,
  };
}

// ---------------------------------------------------------------------------
// Playlists

async function playlistRaw(id) {
  const answer = await call("getPlaylist", { id: id });
  if (!answer.playlist) throw fail("unavailable", t("No such playlist."));
  return answer.playlist;
}

export async function playlists() {
  const answer = await call("getPlaylists", {});
  return playlistListOf(answer).map((p) => asPlaylist(p, false));
}

export async function playlist({ id }) {
  return asPlaylist(await playlistRaw(id), true);
}

export async function createPlaylist({ name }) {
  const answer = await call("createPlaylist", { name: name }, { post: true });
  if (answer.playlist) return asPlaylist(answer.playlist, false);
  // A server that answers only the usual envelope: the new one is the last
  // made with that name.
  const all = await playlistsRaw();
  for (let i = all.length - 1; i >= 0; i--) {
    if ((all[i].name || "") === name) return asPlaylist(all[i], false);
  }
  throw fail("", t("The server made the playlist but didn't say which it is."));
}

async function playlistsRaw() {
  const answer = await call("getPlaylists", {});
  return playlistListOf(answer);
}

export async function renamePlaylist({ id, name }) {
  await call("updatePlaylist", { playlistId: id, name: name }, { post: true });
}

export async function deletePlaylist({ id }) {
  await call("deletePlaylist", { id: id }, { post: true });
}

export async function addToPlaylist({ id, trackIds }) {
  if (!trackIds || trackIds.length === 0) return;
  await call("updatePlaylist", { playlistId: id, songIdToAdd: trackIds }, { post: true });
}

export async function removeFromPlaylist({ id, trackIds }) {
  const p = await playlistRaw(id);
  const entries = (p.entry || []).filter((e) => e && e.id && !e.isDir);
  const used = {};
  const indexes = [];
  for (const wanted of trackIds || []) {
    for (let i = 0; i < entries.length; i++) {
      if (!used[i] && entries[i].id === wanted) {
        used[i] = true;
        indexes.push(i);
        break;
      }
    }
  }
  if (indexes.length === 0) return;
  // Later indexes first: a server that takes them one by one then still finds
  // each at its place.
  indexes.sort((a, b) => b - a);
  await call("updatePlaylist", { playlistId: id, songIndexToRemove: indexes }, { post: true });
}

export async function movePlaylistTrack({ id, from, to }) {
  const p = await playlistRaw(id);
  const entries = (p.entry || []).filter((e) => e && e.id && !e.isDir);
  const start = Number(from);
  const end = Number(to);
  if (start < 0 || start >= entries.length || end < 0 || end >= entries.length) {
    throw fail("", t("That song isn't in the playlist."));
  }
  const ids = entries.map((e) => e.id);
  const moved = ids.splice(start, 1)[0];
  ids.splice(end, 0, moved);
  // Subsonic has no way to move one song. A playlist made again with its ID
  // takes the songs it is given in their new order, which the server does in
  // one go.
  await call(
    "createPlaylist",
    { playlistId: id, name: p.name || "", songId: ids },
    { post: true },
  );
}

// ---------------------------------------------------------------------------
// Radio

export function stations() {
  return [
    {
      id: "random",
      name: t("Shuffle All"),
      description: t("Anything from your library, in no order."),
    },
    {
      id: "starred",
      name: t("Starred Mix"),
      description: t("Your starred songs, shuffled."),
    },
  ];
}

export async function stationNext({ id }) {
  if (id === "starred") {
    const star = await starredNow(false);
    return shuffled(star.songs).slice(0, 30).map(asTrack);
  }
  const answer = await call("getRandomSongs", { size: 50 });
  const list = answer.randomSongs && answer.randomSongs.song ? answer.randomSongs.song : [];
  return list.map(asTrack);
}

// ---------------------------------------------------------------------------
// Lyrics

export async function lyrics({ id }) {
  try {
    const answer = await call("getLyricsBySongId", { id: id });
    const list = (answer.lyricsList && answer.lyricsList.structuredLyrics) || [];
    let synced = null;
    for (const l of list) {
      if (l && l.synced) {
        synced = l;
        break;
      }
    }
    if (!synced) return {};
    const lines = [];
    for (const l of synced.line || []) {
      const text = l && l.value ? String(l.value) : "";
      if (!text) continue;
      lines.push({ start: Math.round(Number(l.start) || 0), text: text });
    }
    if (lines.length === 0) return {};
    lines.sort((a, b) => a.start - b.start);
    for (let i = 0; i < lines.length; i++) {
      const next = i + 1 < lines.length ? lines[i + 1].start : lines[i].start + 6000;
      lines[i].end = Math.min(next, lines[i].start + 6000);
    }
    return { lines: lines };
  } catch (e) {
    // A server without synced lyrics has none to show, rather than a fault.
    if (e && (e.code === "setup" || e.code === "signIn")) throw e;
    return {};
  }
}

// ---------------------------------------------------------------------------
// Audio

const TYPES = {
  mp3: "mp3",
  mp2: "mp3",
  flac: "flac",
  ogg: "ogg",
  oga: "ogg",
  wav: "wav",
  wave: "wav",
  m4a: "m4a",
  mp4: "m4a",
  m4b: "m4a",
  alac: "m4a",
  aac: "aac",
};

async function songRaw(id) {
  if (songs.has(id)) return songs.get(id);
  const answer = await call("getSong", { id: id });
  const raw = answer.song || {};
  if (!raw.id) throw fail("unavailable", t("The server doesn't have this song."));
  remember(raw);
  return raw;
}

export async function stream({ id, quality }) {
  if (!configured()) throw setupNeeded();
  const raw = await songRaw(id);
  const suffix = String(raw.suffix || "").toLowerCase();
  const type = TYPES[suffix] || "";

  const maxBitRate = quality === "standard" ? 128 : 320;
  const bitRate = Number(raw.bitRate) || 0;
  // Lossless plays the file as the server keeps it. Anything else is mp3 320
  // or 128, but an mp3 that's already no better than that is played as it is,
  // as the server needn't transcode it then.
  const original =
    quality === "lossless"
      ? type !== ""
      : type === "mp3" && (bitRate === 0 || bitRate <= maxBitRate);

  const params = { id: id };
  let kind = type;
  if (original) {
    params.format = "raw";
    params.maxBitRate = 0;
  } else {
    params.format = "mp3";
    params.maxBitRate = maxBitRate;
    kind = "mp3";
  }

  const out = {
    url: baseURL() + "/rest/stream?" + qs(Object.assign(authParams(), params)),
    type: kind,
  };
  // A stream the server transcodes is neither the size nor the gain the file
  // had.
  if (params.format === "raw") {
    if (raw.size) out.size = Number(raw.size);
    const gain = raw.replayGain;
    if (gain) {
      const trackGain = gain.trackGain === undefined ? gain.albumGain : gain.trackGain;
      const trackPeak = gain.trackPeak === undefined ? gain.albumPeak : gain.trackPeak;
      if (typeof trackGain === "number") out.gain = trackGain;
      if (typeof trackPeak === "number") out.peak = trackPeak;
      if (out.peak === 0) delete out.peak;
      if (out.gain === 0) delete out.gain;
    }
  }
  return out;
}

// What the server hears when a song is played: its scrobbles, and the play
// counts its own lists use.
export async function played({ id }) {
  await call("scrobble", { id: id, submission: true }, { post: true });
}
