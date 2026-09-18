(() => {
  "use strict";

  const STORAGE_KEY = "north-stand-music-state";
  const FALLBACK_PLAYLIST = [
    "/audio/the-angel-north-london-forever.m4a",
    "/audio/north-london-forever-2.mp3"
  ];

  if (document.querySelector("[data-home-music]")) {
    return;
  }

  function readState() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  const saved = readState();
  if (!saved || saved.userPaused || saved.playing !== true) {
    return;
  }

  const sources = FALLBACK_PLAYLIST;
  let index = Number.isInteger(Number(saved.index))
    ? Number(saved.index) % sources.length
    : 0;
  let shouldPlay = true;
  let saveSecond = -1;
  let unmuteTimer = null;
  let autoplayArmed = false;
  let consecutiveErrors = 0;

  const audio = document.createElement("audio");
  audio.dataset.globalMusic = "";
  audio.preload = "auto";
  audio.volume = 0.62;
  audio.src = sources[index];
  document.body.append(audio);

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          playlist: sources,
          index,
          currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
          playing: shouldPlay,
          userPaused: false,
          updatedAt: Date.now()
        })
      );
    } catch {
      // Playback continues when storage is unavailable.
    }
  }

  function clearAutoplayWait() {
    if (!autoplayArmed) {
      return;
    }
    document.removeEventListener("pointerdown", startFromGesture, true);
    document.removeEventListener("keydown", startFromGesture, true);
    document.removeEventListener("touchstart", startFromGesture, true);
    autoplayArmed = false;
  }

  function armAutoplay() {
    if (autoplayArmed) {
      return;
    }
    autoplayArmed = true;
    document.addEventListener("pointerdown", startFromGesture, true);
    document.addEventListener("keydown", startFromGesture, true);
    document.addEventListener("touchstart", startFromGesture, true);
  }

  function scheduleUnmute() {
    window.clearTimeout(unmuteTimer);
    unmuteTimer = window.setTimeout(() => {
      if (!audio.paused) {
        audio.muted = false;
      }
    }, 520);
  }

  async function startMusic() {
    if (!shouldPlay || !audio.paused) {
      return true;
    }
    audio.muted = true;
    try {
      await audio.play();
      clearAutoplayWait();
      scheduleUnmute();
      saveState();
      return true;
    } catch {
      audio.muted = false;
      armAutoplay();
      return false;
    }
  }

  function startFromGesture(event) {
    if (event.target.closest?.("[data-home-music], [data-music-toggle]")) {
      clearAutoplayWait();
      return;
    }
    audio.muted = false;
    startMusic();
  }

  function setTrack(nextIndex) {
    index = ((nextIndex % sources.length) + sources.length) % sources.length;
    audio.src = sources[index];
    audio.muted = true;
    audio.load();
    startMusic();
    saveState();
  }

  function restorePosition() {
    const resumeTime = Math.max(0, Number(saved.currentTime) || 0);
    if (!resumeTime) {
      return;
    }
    try {
      audio.currentTime = Math.min(
        resumeTime,
        Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.5) : resumeTime
      );
    } catch {
      // Wait until the browser has enough media data.
    }
  }

  audio.addEventListener("loadedmetadata", () => {
    restorePosition();
    startMusic();
  });
  audio.addEventListener("play", () => {
    shouldPlay = true;
    consecutiveErrors = 0;
    scheduleUnmute();
    saveState();
  });
  audio.addEventListener("timeupdate", () => {
    const second = Math.floor(audio.currentTime);
    if (second % 5 === 0 && second !== saveSecond) {
      saveSecond = second;
      saveState();
    }
  });
  audio.addEventListener("ended", () => setTrack(index + 1));
  audio.addEventListener("error", () => {
    consecutiveErrors += 1;
    if (consecutiveErrors < sources.length) {
      setTrack(index + 1);
    }
  });

  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLVideoElement) {
        audio.pause();
        saveState();
      }
    },
    true
  );

  window.addEventListener("pagehide", saveState);
  startMusic();
})();
