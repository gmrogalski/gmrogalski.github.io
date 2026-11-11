(function () {
  "use strict";

  var MAZE_ROWS = [
    "#####################",
    "#.........#.........#",
    "#.###.###.#.###.###.#",
    "#o#...#...#...#...#o#",
    "#.###.#.#####.#.###.#",
    "#.....#...#...#.....#",
    "#####.###.#.###.#####",
    ".....................",
    "#####.###.#.###.#####",
    "#.....#...#...#.....#",
    "#.###.#.#####.#.###.#",
    "#o#...#...#...#...#o#",
    "#.###.###.#.###.###.#",
    "#.........#.........#",
    "#####################"
  ];

  var DIRECTIONS = {
    up: { x: 0, y: -1, angle: -Math.PI / 2 },
    right: { x: 1, y: 0, angle: 0 },
    down: { x: 0, y: 1, angle: Math.PI / 2 },
    left: { x: -1, y: 0, angle: Math.PI }
  };
  var DIRECTION_NAMES = ["up", "right", "down", "left"];
  var PLAYER_START = { x: 1, y: 13 };
  var ENEMY_STARTS = [
    { x: 9, y: 7 },
    { x: 10, y: 7 },
    { x: 11, y: 7 },
    { x: 12, y: 7 }
  ];

  function initGame(root) {
    if (root.getAttribute("data-pr-ready") === "1") return;
    root.setAttribute("data-pr-ready", "1");

    var canvas = root.querySelector(".pr-canvas");
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    var overlay = root.querySelector("[data-overlay]");
    var startForm = root.querySelector("[data-start-form]");
    var nameInput = root.querySelector("[data-player-name]");
    var overlayAction = root.querySelector("[data-overlay-action]");
    var overlayTitle = root.querySelector("[data-overlay-title]");
    var overlayCopy = root.querySelector("[data-overlay-copy]");
    var overlayKicker = root.querySelector("[data-overlay-kicker]");
    var scoreLabel = root.querySelector("[data-score]");
    var livesLabel = root.querySelector("[data-lives]");
    var levelLabel = root.querySelector("[data-level]");
    var gameMessage = root.querySelector("[data-game-message]");
    var leaderboard = root.querySelector("[data-leaderboard]");
    var rankingStatus = root.querySelector("[data-ranking-status]");
    var pauseButton = root.querySelector("[data-pause]");
    var finishButton = root.querySelector("[data-finish]");
    var restartButton = root.querySelector("[data-restart]");

    if (!canvas || !ctx || !overlay || !startForm || !nameInput || !overlayAction || !scoreLabel || !livesLabel || !levelLabel) return;

    var playerSprite = new Image();
    var enemySprite = new Image();
    playerSprite.src = root.getAttribute("data-player-src") || "";
    enemySprite.src = root.getAttribute("data-enemy-src") || "";

    var apiUrl = window.PACROGAL_CONFIG && window.PACROGAL_CONFIG.endpoint ? String(window.PACROGAL_CONFIG.endpoint).trim() : "";
    var localStorageKey = "pacrogal-arcade-scores-v1";
    var cellSize = 40;
    var state = "idle";
    var maze = [];
    var dotsRemaining = 0;
    var score = 0;
    var lives = 3;
    var level = 1;
    var playerName = "";
    var player = null;
    var enemies = [];
    var powerUntil = 0;
    var freezeUntil = 0;
    var lastCollision = 0;
    var resultSaved = false;
    var frameRequested = false;
    var touchStart = null;

    function makeEntity(x, y, direction, index) {
      return {
        x: x,
        y: y,
        oldX: x,
        oldY: y,
        direction: direction,
        nextDirection: direction,
        lastMove: 0,
        interval: 140,
        active: true,
        respawnAt: 0,
        index: index || 0
      };
    }

    function isTunnelRow(y) {
      return y === 7;
    }

    function targetFor(x, y, directionName) {
      var direction = DIRECTIONS[directionName];
      if (!direction) return null;
      var nextX = x + direction.x;
      var nextY = y + direction.y;
      if (isTunnelRow(y) && nextY === y) {
        if (nextX < 0) nextX = MAZE_ROWS[0].length - 1;
        if (nextX >= MAZE_ROWS[0].length) nextX = 0;
      }
      return { x: nextX, y: nextY };
    }

    function isWalkable(x, y) {
      if (y < 0 || y >= maze.length) return false;
      if (isTunnelRow(y)) {
        if (x < 0) x = MAZE_ROWS[0].length - 1;
        if (x >= MAZE_ROWS[0].length) x = 0;
      }
      if (x < 0 || x >= maze[y].length) return false;
      return maze[y][x] !== "#";
    }

    function resetMaze() {
      maze = MAZE_ROWS.map(function (row) { return row.split(""); });
      maze[PLAYER_START.y][PLAYER_START.x] = " ";
      ENEMY_STARTS.forEach(function (spawn) { maze[spawn.y][spawn.x] = " "; });
      dotsRemaining = 0;
      for (var y = 0; y < maze.length; y += 1) {
        for (var x = 0; x < maze[y].length; x += 1) {
          if (maze[y][x] === "." || maze[y][x] === "o") dotsRemaining += 1;
        }
      }
      resetActors();
    }

    function resetActors() {
      var now = performance.now();
      player = makeEntity(PLAYER_START.x, PLAYER_START.y, "right", 0);
      player.lastMove = now;
      enemies = ENEMY_STARTS.map(function (spawn, index) {
        var direction = index % 2 ? "left" : "right";
        var enemy = makeEntity(spawn.x, spawn.y, direction, index);
        enemy.lastMove = now + index * 230;
        return enemy;
      });
      powerUntil = 0;
      freezeUntil = now + 450;
    }

    function formatScore(value) {
      try {
        return Number(value).toLocaleString("pl-PL");
      } catch (error) {
        return String(value);
      }
    }

    function updateHud() {
      scoreLabel.textContent = formatScore(score);
      livesLabel.textContent = String(lives) + " / 3";
      levelLabel.textContent = String(level);
    }

    function updateButtons() {
      pauseButton.disabled = state === "idle" || state === "over";
      finishButton.disabled = state === "idle" || state === "over";
      restartButton.disabled = state === "idle";
      pauseButton.textContent = state === "paused" ? "Wznów" : "Wstrzymaj";
    }

    function showOverlay(mode) {
      overlay.hidden = false;
      startForm.hidden = mode !== "idle";
      overlayAction.hidden = mode === "idle";
      if (mode === "idle") {
        overlayKicker.textContent = "GOTOWY NA ROZGRYWKĘ?";
        overlayTitle.textContent = "PacRogal";
        overlayCopy.textContent = "Zbierz wszystkie okruszki i omijaj kajzerki. Duże rogale dają chwilę przewagi.";
        overlayAction.textContent = "Rozpocznij grę";
      } else if (mode === "paused") {
        overlayKicker.textContent = "CHWILA ODDECHU";
        overlayTitle.textContent = "Gra wstrzymana";
        overlayCopy.textContent = "Twój wynik jest bezpieczny. Wznów, gdy będziesz gotowy.";
        overlayAction.textContent = "Wznów grę";
      } else {
        overlayKicker.textContent = "KONIEC ROZGRYWKI";
        overlayTitle.textContent = "Koniec gry";
        overlayCopy.textContent = playerName + ", zdobywasz " + formatScore(score) + " pkt. Najlepszy wynik trafia do rankingu.";
        overlayAction.textContent = "Zagraj ponownie";
      }
    }

    function hideOverlay() {
      overlay.hidden = true;
    }

    function setMessage(text) {
      gameMessage.textContent = text;
    }

    function localScores() {
      try {
        var stored = localStorage.getItem(localStorageKey);
        var parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function saveLocalScore(name, value, reachedLevel) {
      var entries = localScores();
      var key = name.toLocaleLowerCase();
      var existing = null;
      for (var i = 0; i < entries.length; i += 1) {
        if (String(entries[i].name).toLocaleLowerCase() === key) existing = entries[i];
      }
      if (!existing) {
        entries.push({ name: name, score: value, level: reachedLevel });
      } else if (value > Number(existing.score)) {
        existing.name = name;
        existing.score = value;
        existing.level = reachedLevel;
      }
      entries.sort(function (a, b) {
        if (Number(b.score) !== Number(a.score)) return Number(b.score) - Number(a.score);
        return Number(b.level) - Number(a.level);
      });
      entries = entries.slice(0, 10);
      try {
        localStorage.setItem(localStorageKey, JSON.stringify(entries));
      } catch (error) {
        return entries;
      }
      return entries;
    }

    function renderLeaderboard(entries) {
      leaderboard.innerHTML = "";
      if (!entries || !entries.length) {
        var empty = document.createElement("li");
        empty.className = "pr-empty-score";
        empty.textContent = "Brak wyników. Zagraj jako pierwszy!";
        leaderboard.appendChild(empty);
        return;
      }
      entries.slice(0, 10).forEach(function (entry) {
        var item = document.createElement("li");
        var name = document.createElement("span");
        var meta = document.createElement("span");
        name.className = "pr-score-name";
        name.textContent = String(entry.name || "Gracz");
        meta.className = "pr-score-meta";
        meta.textContent = formatScore(Number(entry.score) || 0) + " · " + (Number(entry.level) || 1) + " lvl";
        item.appendChild(name);
        item.appendChild(meta);
        leaderboard.appendChild(item);
      });
    }

    function requestJsonpScores() {
      return new Promise(function (resolve, reject) {
        var callbackName = "pacrogalScores_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
        var script = document.createElement("script");
        var separator = apiUrl.indexOf("?") === -1 ? "?" : "&";
        var timeoutId = setTimeout(function () {
          cleanup();
          reject(new Error("Przekroczono czas oczekiwania na ranking."));
        }, 10000);

        function cleanup() {
          clearTimeout(timeoutId);
          if (script.parentNode) script.parentNode.removeChild(script);
          try { delete window[callbackName]; } catch (error) { window[callbackName] = undefined; }
        }

        window[callbackName] = function (data) {
          cleanup();
          resolve(data);
        };
        script.onerror = function () {
          cleanup();
          reject(new Error("Nie udało się pobrać rankingu."));
        };
        script.src = apiUrl + separator + "action=scores&callback=" + encodeURIComponent(callbackName) + "&t=" + Date.now();
        document.head.appendChild(script);
      });
    }

    function readGlobalScores() {
      if (!apiUrl || apiUrl.indexOf("https://") !== 0) {
        renderLeaderboard(localScores());
        rankingStatus.textContent = "Ranking lokalny — wyniki z tej przeglądarki.";
        return;
      }
      requestJsonpScores().then(function (data) {
        if (!data || !Array.isArray(data.scores)) throw new Error("Nieprawidłowa odpowiedź rankingu.");
        renderLeaderboard(data.scores || []);
        rankingStatus.textContent = "Wspólny ranking graczy";
      }).catch(function () {
        renderLeaderboard(localScores());
        rankingStatus.textContent = "Ranking online jest niedostępny. Pokazuję zapis lokalny.";
      });
    }

    function saveResult() {
      if (resultSaved || !playerName) return;
      resultSaved = true;
      var savedLocal = saveLocalScore(playerName, score, level);
      if (!apiUrl || apiUrl.indexOf("https://") !== 0) {
        renderLeaderboard(savedLocal);
        rankingStatus.textContent = "Wynik zapisany lokalnie w tej przeglądarce.";
        return;
      }

      rankingStatus.textContent = "Wysyłam wynik do wspólnego rankingu…";
      fetch(apiUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "save", name: playerName, score: score, level: level })
      }).then(function () {
        rankingStatus.textContent = "Wynik wysłany. Odświeżam wspólny ranking…";
        setTimeout(readGlobalScores, 1200);
      }).catch(function () {
        renderLeaderboard(savedLocal);
        rankingStatus.textContent = "Nie udało się wysłać wyniku. Zachowano go lokalnie.";
      });
    }

    function startRun(name) {
      playerName = name;
      score = 0;
      lives = 3;
      level = 1;
      resultSaved = false;
      resetMaze();
      state = "playing";
      setMessage("Zbieraj okruszki i uważaj na kajzerki!");
      updateHud();
      updateButtons();
      hideOverlay();
      canvas.focus();
      if (!frameRequested) {
        frameRequested = true;
        requestAnimationFrame(frame);
      }
    }

    function finishRun() {
      if (state === "over" || state === "idle") return;
      state = "over";
      updateButtons();
      showOverlay("over");
      setMessage("Rozgrywka zakończona. Twój wynik: " + formatScore(score) + " pkt.");
      saveResult();
    }

    function nextLevel(now) {
      level += 1;
      score += 500;
      resetMaze();
      freezeUntil = now + 950;
      updateHud();
      setMessage("Poziom ukończony! Bonus 500 pkt. Poziom " + level + ".");
    }

    function reverseDirection(directionName) {
      if (directionName === "up") return "down";
      if (directionName === "down") return "up";
      if (directionName === "left") return "right";
      return "left";
    }

    function chooseEnemyDirection(enemy, now) {
      var possible = [];
      for (var i = 0; i < DIRECTION_NAMES.length; i += 1) {
        var name = DIRECTION_NAMES[i];
        var target = targetFor(enemy.x, enemy.y, name);
        if (target && isWalkable(target.x, target.y)) possible.push(name);
      }
      if (possible.length > 1) {
        var reverse = reverseDirection(enemy.direction);
        possible = possible.filter(function (name) { return name !== reverse; });
      }
      if (!possible.length) return reverseDirection(enemy.direction);
      if (powerUntil > now || Math.random() < 0.18) {
        return possible[Math.floor(Math.random() * possible.length)];
      }

      var distances = distanceMap(player.x, player.y);
      var best = possible[0];
      var bestDistance = Infinity;
      possible.forEach(function (name) {
        var target = targetFor(enemy.x, enemy.y, name);
        var distance = distances[target.y][target.x];
        if (distance < bestDistance) {
          best = name;
          bestDistance = distance;
        }
      });
      return best;
    }

    function distanceMap(startX, startY) {
      var distances = [];
      for (var y = 0; y < maze.length; y += 1) {
        distances.push(maze[y].map(function () { return Infinity; }));
      }
      if (!distances[startY] || !isWalkable(startX, startY)) return distances;
      var queue = [{ x: startX, y: startY }];
      var head = 0;
      distances[startY][startX] = 0;
      while (head < queue.length) {
        var current = queue[head];
        head += 1;
        for (var i = 0; i < DIRECTION_NAMES.length; i += 1) {
          var next = targetFor(current.x, current.y, DIRECTION_NAMES[i]);
          if (!next || !isWalkable(next.x, next.y)) continue;
          if (distances[next.y][next.x] !== Infinity) continue;
          distances[next.y][next.x] = distances[current.y][current.x] + 1;
          queue.push(next);
        }
      }
      return distances;
    }

    function movePlayer(now) {
      var interval = Math.max(86, 137 - (level - 1) * 5);
      if (now - player.lastMove < interval) return;
      player.oldX = player.x;
      player.oldY = player.y;
      var next = targetFor(player.x, player.y, player.nextDirection);
      if (next && isWalkable(next.x, next.y)) player.direction = player.nextDirection;
      next = targetFor(player.x, player.y, player.direction);
      if (next && isWalkable(next.x, next.y)) {
        player.x = next.x;
        player.y = next.y;
      }
      player.lastMove = now;
      player.interval = interval;
      collectAtPlayer(now);
    }

    function collectAtPlayer(now) {
      var item = maze[player.y][player.x];
      if (item === ".") {
        maze[player.y][player.x] = " ";
        dotsRemaining -= 1;
        score += 10;
        updateHud();
      } else if (item === "o") {
        maze[player.y][player.x] = " ";
        dotsRemaining -= 1;
        score += 50;
        powerUntil = now + Math.max(5000, 7800 - (level - 1) * 350);
        setMessage("Rogalowa moc! Kajzerki na chwilę są do złapania.");
        updateHud();
      }
      if (dotsRemaining <= 0) nextLevel(now);
    }

    function moveEnemy(enemy, now) {
      if (!enemy.active) {
        if (now >= enemy.respawnAt) {
          var spawn = ENEMY_STARTS[enemy.index];
          enemy.x = spawn.x;
          enemy.y = spawn.y;
          enemy.oldX = spawn.x;
          enemy.oldY = spawn.y;
          enemy.active = true;
          enemy.lastMove = now;
        }
        return;
      }
      var interval = Math.max(135, 225 - (level - 1) * 7);
      if (now - enemy.lastMove < interval) return;
      enemy.oldX = enemy.x;
      enemy.oldY = enemy.y;
      enemy.direction = chooseEnemyDirection(enemy, now);
      var next = targetFor(enemy.x, enemy.y, enemy.direction);
      if (next && isWalkable(next.x, next.y)) {
        enemy.x = next.x;
        enemy.y = next.y;
      }
      enemy.lastMove = now;
      enemy.interval = interval;
    }

    function positionOf(entity, now) {
      if (entity.y === 7 && entity.oldY === 7 && Math.abs(entity.x - entity.oldX) > 1) {
        return { x: entity.x, y: entity.y };
      }
      var progress = entity.interval ? Math.min(1, Math.max(0, (now - entity.lastMove) / entity.interval)) : 1;
      return {
        x: entity.oldX + (entity.x - entity.oldX) * progress,
        y: entity.oldY + (entity.y - entity.oldY) * progress
      };
    }

    function checkCollisions(now) {
      if (now < freezeUntil || now - lastCollision < 450) return;
      var p = positionOf(player, now);
      for (var i = 0; i < enemies.length; i += 1) {
        var enemy = enemies[i];
        if (!enemy.active) continue;
        var e = positionOf(enemy, now);
        if (Math.abs(p.x - e.x) < 0.48 && Math.abs(p.y - e.y) < 0.48) {
          lastCollision = now;
          if (powerUntil > now) {
            score += 200;
            enemy.active = false;
            enemy.respawnAt = now + 1750;
            updateHud();
            setMessage("Kajzerka złapana! +200 pkt.");
          } else {
            lives -= 1;
            updateHud();
            if (lives <= 0) {
              finishRun();
              return;
            }
            resetActors();
            setMessage("Ostrożnie! Zostało żyć: " + lives + ".");
          }
          return;
        }
      }
    }

    function drawWall(x, y) {
      var px = x * cellSize;
      var py = y * cellSize;
      ctx.fillStyle = "#141a46";
      ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
      ctx.strokeStyle = "rgba(115, 112, 240, .62)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 3, py + 3, cellSize - 6, cellSize - 6);
      ctx.fillStyle = "rgba(130, 128, 255, .08)";
      ctx.fillRect(px + 6, py + 6, cellSize - 12, 3);
    }

    function drawCrumb(x, y, power) {
      var cx = x * cellSize + cellSize / 2;
      var cy = y * cellSize + cellSize / 2;
      ctx.save();
      if (power) {
        ctx.shadowColor = "#f3bd54";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "#ffdc83";
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = "#f0d5a0";
        ctx.beginPath();
        ctx.arc(cx, cy, 2.7, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }

    function drawActor(sprite, entity, now, size, angle, scared) {
      var pos = positionOf(entity, now);
      var cx = pos.x * cellSize + cellSize / 2;
      var cy = pos.y * cellSize + cellSize / 2;
      if (scared) {
        ctx.beginPath();
        ctx.arc(cx, cy, size * .46, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(67, 190, 203, .28)";
        ctx.fill();
        ctx.strokeStyle = "rgba(117, 237, 214, .75)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (!sprite.complete || !sprite.naturalWidth) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle || 0);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    function render(now) {
      ctx.fillStyle = "#070b12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (var y = 0; y < maze.length; y += 1) {
        for (var x = 0; x < maze[y].length; x += 1) {
          var item = maze[y][x];
          if (item === "#") drawWall(x, y);
          else if (item === ".") drawCrumb(x, y, false);
          else if (item === "o") drawCrumb(x, y, true);
        }
      }

      if (player) {
        drawActor(playerSprite, player, now, 36, DIRECTIONS[player.direction].angle, false);
      }
      enemies.forEach(function (enemy) {
        if (enemy.active) drawActor(enemySprite, enemy, now, 36, 0, powerUntil > now);
      });

      if (state === "playing" && powerUntil > now) {
        ctx.fillStyle = "rgba(105, 221, 195, .9)";
        ctx.font = "bold 12px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MOC ROGALA", canvas.width / 2, 18);
      }
    }

    function frame(now) {
      if (state === "playing" && now >= freezeUntil) {
        movePlayer(now);
        if (state === "playing" && now >= freezeUntil) {
          enemies.forEach(function (enemy) { moveEnemy(enemy, now); });
          checkCollisions(now);
        }
      }
      render(now);
      requestAnimationFrame(frame);
    }

    function requestDirection(name) {
      if (!DIRECTIONS[name] || state !== "playing") return;
      player.nextDirection = name;
    }

    root.addEventListener("keydown", function (event) {
      if (event.target && event.target.tagName && event.target.tagName.toUpperCase() === "INPUT") return;
      var key = String(event.key || "").toLowerCase();
      var direction = null;
      if (key === "arrowup" || key === "w") direction = "up";
      else if (key === "arrowright" || key === "d") direction = "right";
      else if (key === "arrowdown" || key === "s") direction = "down";
      else if (key === "arrowleft" || key === "a") direction = "left";
      if (direction && state === "playing") {
        event.preventDefault();
        requestDirection(direction);
      } else if (key === "escape") {
        event.preventDefault();
        if (state === "playing") {
          state = "paused";
          showOverlay("paused");
          updateButtons();
        } else if (state === "paused") {
          state = "playing";
          hideOverlay();
          updateButtons();
        }
      }
    });

    startForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = nameInput.value.replace(/\s+/g, " ").trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      startRun(name.slice(0, 20));
    });

    overlayAction.addEventListener("click", function () {
      if (state === "paused") {
        state = "playing";
        hideOverlay();
        updateButtons();
        canvas.focus();
      } else if (state === "over") {
        startRun(playerName);
      }
    });

    pauseButton.addEventListener("click", function () {
      if (state === "playing") {
        state = "paused";
        showOverlay("paused");
      } else if (state === "paused") {
        state = "playing";
        hideOverlay();
      }
      updateButtons();
    });

    finishButton.addEventListener("click", finishRun);
    restartButton.addEventListener("click", function () {
      if (state === "playing" || state === "paused") saveResult();
      if (playerName) startRun(playerName);
    });

    var directionButtons = root.querySelectorAll("[data-direction]");
    for (var i = 0; i < directionButtons.length; i += 1) {
      directionButtons[i].addEventListener("click", function (event) {
        canvas.focus();
        requestDirection(event.currentTarget.getAttribute("data-direction"));
      });
    }

    canvas.addEventListener("pointerdown", function (event) {
      touchStart = { x: event.clientX, y: event.clientY };
      if (state === "playing") canvas.focus();
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", function (event) {
      if (!touchStart) return;
      var dx = event.clientX - touchStart.x;
      var dy = event.clientY - touchStart.y;
      touchStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
      canvas.focus();
      if (Math.abs(dx) > Math.abs(dy)) requestDirection(dx > 0 ? "right" : "left");
      else requestDirection(dy > 0 ? "down" : "up");
    });
    canvas.addEventListener("pointercancel", function () { touchStart = null; });

    resetMaze();
    updateHud();
    updateButtons();
    showOverlay("idle");
    readGlobalScores();
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function boot() {
    var games = document.querySelectorAll(".pr-app");
    for (var i = 0; i < games.length; i += 1) initGame(games[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
