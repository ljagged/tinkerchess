"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { clearPending, loadPending, loadSeat, savePending, saveSeat } from "./seat";
import { ChunkedTokenInput, CopyButton, formatToken } from "./token";
import { errText } from "./errors";
import { TimeControlPicker } from "./TimeControlPicker";
import { DEFAULT_TIME_CONTROL, type TimeControlId } from "@/src/timecontrol";

const NAME_KEY = "tinkerchess:name";
const TC_KEY = "tinkerchess:timeControl";
const MAX_NAME = 24;

export default function Home() {
  const createGame = useMutation(api.games.createGame);
  const createBotGame = useMutation(api.games.createBotGame);
  const joinByToken = useMutation(api.games.joinByToken);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showBot, setShowBot] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [token, setToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [spectatorGame, setSpectatorGame] = useState<string | null>(null);

  // Display name, remembered locally so returning players don't retype it. The
  // ruleset picker is intentionally hidden for now (defaults apply); it returns
  // with a fuller settings screen later.
  const [playerName, setPlayerName] = useState("");
  // Chosen time control, remembered locally so it defaults to your last pick.
  const [timeControl, setTimeControl] = useState<TimeControlId>(DEFAULT_TIME_CONTROL);
  // Which side you take against the bot ("random" lets the server choose).
  const [side, setSide] = useState<"white" | "black" | "random">("random");
  useEffect(() => {
    try {
      setPlayerName(localStorage.getItem(NAME_KEY) ?? "");
      const tc = localStorage.getItem(TC_KEY) as TimeControlId | null;
      if (tc) setTimeControl(tc);
    } catch {
      /* ignore */
    }
  }, []);
  const rememberName = (n: string) => {
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* ignore */
    }
  };

  // A game the initiator created and is waiting on. We stay on the splash and
  // only go to the board once an opponent joins (so they never see the board —
  // or a color that might flip — before the game actually starts).
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => setPendingId(loadPending()), []);

  const pendingSeat = pendingId ? loadSeat(pendingId) : null;
  const pendingView = useQuery(
    api.games.getGameView,
    pendingId && pendingSeat
      ? { gameId: pendingId as Id<"games">, seatToken: pendingSeat.seatToken ?? undefined }
      : "skip",
  );

  useEffect(() => {
    if (!pendingId || pendingView === undefined) return;
    if (pendingView === null) {
      clearPending();
      setPendingId(null);
    } else if (pendingView.phase === "active") {
      clearPending();
      router.push(`/game/${pendingId}`);
    }
  }, [pendingId, pendingView, router]);

  const onNewGame = async () => {
    const name = playerName.trim() || undefined;
    rememberName(playerName.trim());
    try {
      localStorage.setItem(TC_KEY, timeControl);
    } catch {
      /* ignore */
    }
    setBusy(true);
    try {
      const { gameId, seatToken } = await createGame({ name, timeControl });
      saveSeat(gameId, { seatToken });
      savePending(gameId);
      setPendingId(gameId);
      setShowCreate(false);
    } catch (e) {
      alert(`Could not create a game: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Play the computer. The bot fills the opponent seat immediately, so the game is
  // active at once — go straight to the board (no waiting room). "random" omits
  // botColor and lets the server pick; otherwise the bot takes the color you didn't.
  const onPlayBot = async () => {
    const name = playerName.trim() || undefined;
    rememberName(playerName.trim());
    try {
      localStorage.setItem(TC_KEY, timeControl);
    } catch {
      /* ignore */
    }
    const botColor = side === "white" ? ("b" as const) : side === "black" ? ("w" as const) : undefined;
    setBusy(true);
    try {
      const { gameId, seatToken } = await createBotGame({
        name,
        timeControl,
        ...(botColor ? { botColor } : {}),
      });
      saveSeat(gameId, { seatToken });
      router.push(`/game/${gameId}`);
    } catch (e) {
      alert(`Could not start a game: ${errText(e)}`);
      setBusy(false);
    }
  };

  const cancelWaiting = () => {
    clearPending();
    setPendingId(null);
  };

  const openJoin = () => {
    setShowJoin(true);
    setToken("");
    setJoinError(null);
    setSpectatorGame(null);
  };

  const onJoin = async () => {
    if (token.length < 8) {
      setJoinError("Enter the full 8-character token.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    rememberName(playerName.trim());
    try {
      const { gameId, role, seatToken } = await joinByToken({
        token,
        name: playerName.trim() || undefined,
      });
      saveSeat(gameId, { seatToken });
      if (role === "spectator") {
        setJoining(false);
        setSpectatorGame(gameId);
        return;
      }
      router.push(`/game/${gameId}`);
    } catch (e) {
      setJoining(false);
      setJoinError(errText(e));
    }
  };

  // --- waiting room (stays on the splash) ---
  if (pendingId && pendingView && pendingView.phase === "waiting") {
    const code = pendingView.joinToken ? formatToken(pendingView.joinToken) : "";
    return (
      <main className="wrap">
        <h1 style={{ marginBottom: "0.25rem" }}>TinkerChess</h1>
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 460, display: "grid", gap: "0.9rem", borderColor: "var(--accent)" }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>Waiting for opponent to join…</div>
          <div className="muted">Share this token with your opponent:</div>
          <div className="row" style={{ alignItems: "center", gap: "0.7rem" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.8rem", letterSpacing: "0.15em" }}>
              {code}
            </span>
            <CopyButton text={code} />
          </div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Sides are chosen at random when they join. You’ll go to the board automatically.
          </div>
          <div>
            <button onClick={cancelWaiting}>Cancel</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1 style={{ marginBottom: "0.25rem" }}>TinkerChess</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 620 }}>
        A fog-of-war chess variant. Any non-pawn piece can <strong>phase out</strong> — leave
        the board for a few turns and reappear on its square, removing whatever sits there
        (your own pieces included). You see your phased pieces and their timers; your opponent
        only gets a one-turn warning before a piece returns. It's standard chess otherwise:{" "}
        <strong>win by checkmate.</strong>
      </p>

      {showCreate ? (
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 420, display: "grid", gap: "0.9rem" }}>
          <strong>New game</strong>
          <label className="field-label">
            Player name
            <input
              className="text-input"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.slice(0, MAX_NAME))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) onNewGame();
              }}
              placeholder="e.g. Alex"
              maxLength={MAX_NAME}
              autoFocus
            />
          </label>
          <div className="field-label">
            Time control
            <TimeControlPicker value={timeControl} onChange={setTimeControl} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => setShowCreate(false)} disabled={busy}>Cancel</button>
            <button className="primary" onClick={onNewGame} disabled={busy}>
              {busy ? "Creating…" : "Create game"}
            </button>
          </div>
        </div>
      ) : showBot ? (
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 420, display: "grid", gap: "0.9rem" }}>
          <strong>Play the computer</strong>
          <label className="field-label">
            Player name
            <input
              className="text-input"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.slice(0, MAX_NAME))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) onPlayBot();
              }}
              placeholder="e.g. Alex"
              maxLength={MAX_NAME}
              autoFocus
            />
          </label>
          <div className="field-label">
            Time control
            <TimeControlPicker value={timeControl} onChange={setTimeControl} />
          </div>
          <div className="field-label">
            Play as
            <div className="side-grid" role="radiogroup" aria-label="Play as">
              {(["white", "black", "random"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  role="radio"
                  aria-checked={side === s}
                  className={side === s ? "side-option on" : "side-option"}
                  onClick={() => setSide(s)}
                >
                  {s === "white" ? "White" : s === "black" ? "Black" : "Random"}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => setShowBot(false)} disabled={busy}>Cancel</button>
            <button className="primary" onClick={onPlayBot} disabled={busy}>
              {busy ? "Starting…" : "Play"}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 420 }}>
          <p style={{ marginTop: 0 }}>
            Play the computer now, or start a game and share the token — or join one with a
            token you were given.
          </p>
          <div className="row">
            <button className="primary" onClick={() => setShowBot(true)} disabled={busy}>
              Play Computer
            </button>
            <button onClick={() => setShowCreate(true)} disabled={busy}>
              New Game
            </button>
            <button onClick={openJoin} disabled={busy}>
              Join Game
            </button>
          </div>
        </div>
      )}

      {showJoin && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
          onClick={() => setShowJoin(false)}
        >
          <div
            className="panel"
            style={{ maxWidth: 380, width: "100%", display: "grid", gap: "0.9rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {spectatorGame ? (
              <>
                <strong>This game is already in progress.</strong>
                <p className="muted" style={{ margin: 0 }}>
                  Both seats are taken — you’ll join as a spectator.
                </p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button onClick={() => setShowJoin(false)}>Cancel</button>
                  <button className="primary" onClick={() => router.push(`/game/${spectatorGame}`)}>
                    Watch
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>Join game</strong>
                <label className="field-label">
                  Player name
                  <input
                    className="text-input"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value.slice(0, MAX_NAME))}
                    placeholder="e.g. Alex"
                    maxLength={MAX_NAME}
                  />
                </label>
                <label className="field-label">
                  Game token
                  <ChunkedTokenInput value={token} onChange={setToken} onEnter={onJoin} autoFocus />
                </label>
                {joinError && <div style={{ color: "var(--danger)" }}>{joinError}</div>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button onClick={() => setShowJoin(false)}>Cancel</button>
                  <button className="primary" onClick={onJoin} disabled={joining}>
                    {joining ? "Joining…" : "Join"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
