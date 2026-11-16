(() => {
  "use strict";

  const stage = document.getElementById("stage");
  const roomEl = document.getElementById("room");
  const armEl = document.getElementById("arm");
  const clockEl = document.getElementById("clock");
  const momentEl = document.getElementById("moment");
  const batteryTextEl = document.getElementById("batteryText");
  const batteryFillEl = document.getElementById("batteryFill");
  const statusEl = document.getElementById("status");
  const endPanel = document.getElementById("endPanel");
  const endTitle = document.getElementById("endTitle");
  const endDetail = document.getElementById("endDetail");
  const restartButton = document.getElementById("restart");

  const START_BATTERY = 60;
  const CHECK_COST = 5;
  const CLEAR_COST = 3;
  const REVEAL_DELAY = 1000;
  const HOLD_DELAY = 800;
  const MOMENT_LENGTH = 12000;
  const PASS_AFTER_REVEAL = 9000;
  const PASS_AFTER_LOWER = 2200;
  const PASS_AFTER_CLEAR = 2600;

  const DOORS = ["closed", "open"];
  const LIGHTS = ["unlit", "dying", "weak", "lit"];
  const TYNE_FORMS = new Set(["tyne_far", "tyne_mid", "tyne_near", "tyne_left", "tyne_reach"]);
  const ROOM_ANOMALIES = ["clear", "tyne_far", "tyne_mid", "tyne_near", "tyne_left", "tyne_reach"];

  // Ten fixed hours. Five moments contain one of the two anomalies.
  // Checking every hour and removing every anomaly would consume 65%:
  // (10 x 5%) + (5 x 3%). The 60% charge requires one safe hour to be left
  // unobserved; wasted checks can leave too little battery to remove Tyne.
  const NIGHT = [
    { time: "22:47", anomaly: "clear" },
    { time: "23:31", anomaly: "door" },
    { time: "00:16", anomaly: "clear" },
    { time: "01:02", anomaly: "tyne_far" },
    { time: "01:48", anomaly: "clear" },
    { time: "02:35", anomaly: "tyne_mid" },
    { time: "03:19", anomaly: "door" },
    { time: "04:07", anomaly: "clear" },
    { time: "04:56", anomaly: "tyne_near" },
    { time: "05:43", anomaly: "clear" }
  ];

  let momentIndex = 0;
  let moment = NIGHT[0];
  let battery = START_BATTERY;
  let checked = false;
  let revealed = false;
  let resolved = false;
  let waiting = false;
  let armLocked = false;
  let armRaised = false;
  let armP = 0;
  let dragging = false;
  let dragPointerId = null;
  let dragStartY = 0;
  let dragBaseP = 0;
  let holdActive = false;
  let holdPointerId = null;
  let over = false;

  let momentTimer = null;
  let revealTimer = null;
  let holdTimer = null;
  let passTimer = null;
  const imageCache = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function roomFile(door, light, tyne) {
    return `assets/rooms/room_${door}_${light}_${tyne}.jpg`;
  }

  function unlitFile() {
    return roomFile("closed", "unlit", "clear");
  }

  function lightLevel() {
    if (battery <= 2) return "dying";
    if (battery <= 14) return "weak";
    return "lit";
  }

  function activeAnomaly() {
    return resolved ? "clear" : moment.anomaly;
  }

  function litRoomFile(anomaly = activeAnomaly(), light = lightLevel()) {
    let door = "closed";
    let tyne = "clear";
    if (anomaly === "door") door = "open";
    else if (TYNE_FORMS.has(anomaly)) tyne = anomaly;
    return roomFile(door, light, tyne);
  }

  function showTruth(light = "lit") {
    roomEl.src = litRoomFile(moment.anomaly, light);
  }

  function anomalyLabel(anomaly) {
    if (anomaly === "door") return "ANOMALY 02 / THE DOOR IS OPEN";
    if (TYNE_FORMS.has(anomaly)) return "ANOMALY 01 / BECKTON TYNE";
    return "NO ANOMALY";
  }

  function lossDetail() {
    if (TYNE_FORMS.has(moment.anomaly)) {
      return battery < CLEAR_COST
        ? "THERE WAS NOT ENOUGH BATTERY TO REMOVE BECKTON TYNE."
        : "YOU LOOKED AWAY BEFORE BECKTON TYNE WAS REMOVED.";
    }
    return battery < CLEAR_COST
      ? "THERE WAS NOT ENOUGH BATTERY TO CLOSE THE DOOR."
      : "THE DOOR WAS LEFT OPEN.";
  }

  function updateHud() {
    clockEl.textContent = moment.time;
    momentEl.textContent = `NIGHT ${String(momentIndex + 1).padStart(2, "0")} / ${String(NIGHT.length).padStart(2, "0")}`;
    batteryTextEl.textContent = `BATTERY ${battery}%`;
    batteryFillEl.style.width = `${battery}%`;
    batteryFillEl.style.background = battery <= 10
      ? "rgba(142, 154, 163, 0.66)"
      : "rgba(199, 211, 219, 0.72)";
  }

  function setArmP(p, animate) {
    armP = clamp(p, 0, 1);
    const tx = -2 - 3 * armP;
    const ty = 16 - 15 * armP;
    const rotation = -7 + 4 * armP;
    const scale = 0.96 + 0.04 * armP;
    armEl.style.transition = animate
      ? "transform 220ms cubic-bezier(0.2, 0.72, 0.28, 1)"
      : "none";
    armEl.style.transform = `translate(${tx}%, ${ty}%) rotate(${rotation}deg) scale(${scale})`;
  }

  function setArmOn(on) {
    const next = on ? "assets/arm_phone_on.png" : "assets/arm_phone_off.png";
    if (armEl.getAttribute("src") !== next) armEl.src = next;
  }

  function clearAllTimers() {
    clearTimeout(momentTimer);
    clearTimeout(revealTimer);
    clearTimeout(holdTimer);
    clearTimeout(passTimer);
    momentTimer = null;
    revealTimer = null;
    holdTimer = null;
    passTimer = null;
  }

  function schedulePass(delay) {
    clearTimeout(passTimer);
    passTimer = null;
    if (!over && !waiting) {
      passTimer = setTimeout(onPassTimeout, delay);
    }
  }

  function startMoment() {
    clearAllTimers();
    moment = NIGHT[momentIndex];
    checked = false;
    revealed = false;
    resolved = moment.anomaly === "clear";
    waiting = false;
    armLocked = false;
    armRaised = false;
    dragging = false;
    holdActive = false;
    setArmP(0, false);
    setArmOn(false);
    roomEl.src = unlitFile();
    updateHud();
    setStatus(battery < CHECK_COST
      ? "BATTERY TOO LOW. LEAVE THE PHONE DOWN."
      : "DRAG THE HAND TOWARD THE DOOR.");
    momentTimer = setTimeout(onMomentTimeout, MOMENT_LENGTH);
  }

  function onMomentTimeout() {
    momentTimer = null;
    if (over || waiting) return;
    if (resolved || moment.anomaly === "clear") {
      passMoment();
      return;
    }
    showTruth();
    const detail = TYNE_FORMS.has(moment.anomaly)
      ? "BECKTON TYNE WAS IN THE ROOM."
      : "THE DOOR WAS OPEN.";
    endGame("YOU DID NOT LOOK.", detail);
  }

  function onPassTimeout() {
    passTimer = null;
    if (over || waiting) return;
    if (resolved || moment.anomaly === "clear") {
      passMoment();
      return;
    }
    showTruth();
    endGame(
      TYNE_FORMS.has(moment.anomaly) ? "BECKTON TYNE STAYS." : "THE DOOR STAYS OPEN.",
      lossDetail()
    );
  }

  function passMoment() {
    if (over) return;
    if (momentIndex >= NIGHT.length - 1) {
      endGame(
        "06:12. THE ROOM IS STILL YOURS.",
        `THE PHONE REACHED DAWN AT ${battery}% BATTERY.`
      );
      return;
    }
    momentIndex += 1;
    startMoment();
  }

  function commitRaise() {
    if (over || waiting) return false;
    if (battery < CHECK_COST) {
      setStatus("BATTERY TOO LOW. THE PHONE WILL NOT TURN ON.");
      return false;
    }

    clearTimeout(momentTimer);
    clearTimeout(revealTimer);
    clearTimeout(holdTimer);
    clearTimeout(passTimer);
    momentTimer = null;
    revealTimer = null;
    holdTimer = null;
    passTimer = null;

    battery = Math.max(0, battery - CHECK_COST);
    checked = true;
    revealed = false;
    waiting = true;
    armLocked = true;
    armRaised = true;
    holdActive = false;
    updateHud();
    setArmOn(true);
    setArmP(1, true);
    setStatus("KEEP THE PHONE STEADY.");
    revealTimer = setTimeout(reveal, REVEAL_DELAY);
    return true;
  }

  function reveal() {
    revealTimer = null;
    if (over) return;
    waiting = false;
    armLocked = false;
    revealed = true;
    roomEl.src = litRoomFile(activeAnomaly());

    const anomaly = activeAnomaly();
    if (anomaly === "clear") {
      const hadAnomaly = moment.anomaly !== "clear";
      setStatus(hadAnomaly && resolved
        ? "IT IS GONE. LOWER THE PHONE."
        : "NO ANOMALY. LOWER THE PHONE.");
      schedulePass(PASS_AFTER_REVEAL);
      return;
    }

    if (battery < CLEAR_COST) {
      setStatus(TYNE_FORMS.has(anomaly)
        ? "BATTERY TOO LOW. BECKTON TYNE CANNOT BE REMOVED."
        : "BATTERY TOO LOW. THE DOOR CANNOT BE CLOSED.");
      schedulePass(PASS_AFTER_LOWER);
      return;
    }

    setStatus(`${anomalyLabel(anomaly)}. HOLD THE LIGHT ON IT.`);
    schedulePass(PASS_AFTER_REVEAL);
  }

  function clearAnomaly() {
    if (over || !revealed || resolved || battery < CLEAR_COST) return;
    battery = Math.max(0, battery - CLEAR_COST);
    resolved = true;
    updateHud();
    roomEl.src = litRoomFile("clear");
    setStatus("IT IS GONE. LOWER THE PHONE.");
    schedulePass(PASS_AFTER_CLEAR);
  }

  function canHold() {
    return !over && revealed && !waiting && !resolved && activeAnomaly() !== "clear" && battery >= CLEAR_COST;
  }

  function startHold(event) {
    holdActive = true;
    holdPointerId = event.pointerId;
    clearTimeout(passTimer);
    passTimer = null;
    setStatus("KEEP THE LIGHT STEADY.");
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!holdActive || over || resolved) {
        holdActive = false;
        return;
      }
      holdActive = false;
      if (battery >= CLEAR_COST) clearAnomaly();
      else schedulePass(PASS_AFTER_LOWER);
    }, HOLD_DELAY);
  }

  function cancelHold() {
    if (!holdActive) return;
    holdActive = false;
    holdPointerId = null;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (!over && !resolved && activeAnomaly() !== "clear") {
      setStatus(`${anomalyLabel(activeAnomaly())}. HOLD THE LIGHT ON IT.`);
      schedulePass(PASS_AFTER_LOWER);
    }
  }

  function lowerArm() {
    const wasRevealed = revealed;
    armRaised = false;
    setArmOn(false);
    setArmP(0, true);

    if (wasRevealed && !waiting) {
      revealed = false;
      roomEl.src = unlitFile();
      if (!resolved && activeAnomaly() !== "clear") {
        setStatus(`${anomalyLabel(activeAnomaly())}. RAISE THE PHONE AGAIN OR IT STAYS.`);
      } else {
        setStatus("LOWER THE PHONE. LET THE HOUR PASS.");
      }
      schedulePass(PASS_AFTER_LOWER);
    }
  }

  function endGame(title, detail) {
    if (over) return;
    over = true;
    clearAllTimers();
    dragging = false;
    holdActive = false;
    waiting = false;
    armLocked = true;
    armEl.style.transition = "none";
    endTitle.textContent = title;
    endDetail.textContent = detail;
    endPanel.hidden = false;
    setStatus(title);
    updateHud();
  }

  function restartGame() {
    momentIndex = 0;
    battery = START_BATTERY;
    over = false;
    endPanel.hidden = true;
    startMoment();
  }

  function localPoint(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      rect
    };
  }

  function inTargetZone(x, y) {
    return x >= 0.30 && x <= 0.82 && y >= 0.04 && y <= 0.78;
  }

  function inArmZone(x, y) {
    return x >= 0.34 && y >= 0.42;
  }

  function startDrag(event) {
    if (armP < 0.2 && battery < CHECK_COST) {
      setStatus("BATTERY TOO LOW. THE PHONE WILL NOT TURN ON.");
      return false;
    }
    dragging = true;
    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragBaseP = armP;
    setArmP(armP, false);
    return true;
  }

  function capturePointer(event) {
    try {
      stage.setPointerCapture(event.pointerId);
    } catch (_) {
      // Pointer capture is an optimisation; pointerup is still handled on the stage.
    }
  }

  function releasePointer(event) {
    try {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    } catch (_) {
      // Older iPadOS builds can reject a redundant release.
    }
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("#restart")) return;
    event.preventDefault();
    if (over || waiting || armLocked) return;

    const point = localPoint(event);
    let captured = false;

    if (canHold() && inTargetZone(point.x, point.y)) {
      startHold(event);
      captured = true;
    } else if (inArmZone(point.x, point.y)) {
      captured = startDrag(event);
    }

    if (captured) capturePointer(event);
  });

  stage.addEventListener("pointermove", (event) => {
    if (dragging && event.pointerId === dragPointerId) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const delta = (dragStartY - event.clientY) / (rect.height * 0.28);
      setArmP(dragBaseP + delta, false);
      return;
    }
    if (holdActive && event.pointerId === holdPointerId) {
      event.preventDefault();
      const point = localPoint(event);
      if (!inTargetZone(point.x, point.y)) cancelHold();
    }
  });

  stage.addEventListener("pointerup", (event) => {
    event.preventDefault();

    if (holdActive && event.pointerId === holdPointerId) cancelHold();

    if (dragging && event.pointerId === dragPointerId) {
      dragging = false;
      dragPointerId = null;
      if (armP >= 0.72) {
        if (!commitRaise()) lowerArm();
      } else {
        lowerArm();
      }
    }

    releasePointer(event);
  });

  stage.addEventListener("pointercancel", (event) => {
    if (holdActive && event.pointerId === holdPointerId) cancelHold();
    if (dragging && event.pointerId === dragPointerId) {
      dragging = false;
      dragPointerId = null;
      setArmP(armRaised ? 1 : 0, true);
    }
    releasePointer(event);
  });

  stage.addEventListener("lostpointercapture", (event) => {
    if (holdActive && event.pointerId === holdPointerId) cancelHold();
    if (dragging && event.pointerId === dragPointerId) {
      dragging = false;
      dragPointerId = null;
      setArmP(armRaised ? 1 : 0, true);
    }
  });

  stage.addEventListener("contextmenu", (event) => event.preventDefault());
  restartButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  restartButton.addEventListener("click", (event) => {
    event.stopPropagation();
    restartGame();
  });

  const preventGesture = (event) => event.preventDefault();
  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, { passive: false });
  document.addEventListener("gestureend", preventGesture, { passive: false });
  document.addEventListener("dblclick", preventGesture, { passive: false });

  function preloadRoomStates() {
    for (const door of DOORS) {
      for (const light of LIGHTS) {
        for (const anomaly of ROOM_ANOMALIES) {
          const image = new Image();
          image.decoding = "async";
          image.src = roomFile(door, light, anomaly);
          imageCache.push(image);
        }
      }
    }
  }

  window.addEventListener("load", () => setTimeout(preloadRoomStates, 250));
  startMoment();
})();
