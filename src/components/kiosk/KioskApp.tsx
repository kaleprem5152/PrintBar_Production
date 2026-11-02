"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CompletedScreen, ErrorScreen, IdleScreen, PinScreen, PrintingScreen, RetrievedScreen, type PinUiState } from "./screens";
import type { ErrorKind, KOrder, PrinterState } from "./types";

type Screen = "idle" | "pin" | "retrieved" | "printing" | "completed" | "error";

const FAIL_TO_ERROR: Record<string, ErrorKind> = {
  offline: "printer_offline",
  paper_out: "paper_out",
  paper_jam: "paper_jam",
  error: "print_failed",
};
const STATE_TO_ERROR: Record<string, ErrorKind> = FAIL_TO_ERROR;

export function KioskApp() {
  const [screen, setScreen] = useState<Screen>("idle");
  const [digits, setDigits] = useState("");
  const [pinState, setPinState] = useState<PinUiState>("entering");
  const [attempts, setAttempts] = useState(0);
  const [order, setOrder] = useState<KOrder | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("network");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [printer, setPrinter] = useState<PrinterState>("ready");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25);
  const [origin, setOrigin] = useState("https://printbar.example");
  const lastTouch = useRef(Date.now());
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => setOrigin(window.location.origin), []);

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);

  const reset = useCallback(() => {
    setScreen("idle");
    setDigits("");
    setPinState("entering");
    setAttempts(0);
    setOrder(null);
    setErrorMsg(undefined);
  }, []);

  const showError = useCallback((k: ErrorKind, msg?: string) => {
    setErrorKind(k);
    setErrorMsg(msg);
    setScreen("error");
  }, []);

  /* Printer + network heartbeat */
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      try {
        const r = await fetch("/api/kiosk/status", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (!alive) return;
        setOnline(true);
        setPrinter(j.state as PrinterState);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void beat();
    const id = setInterval(beat, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* Out-of-service handling when idle (no job in progress) */
  useEffect(() => {
    if (!online) {
      if (screen !== "error" || errorKind !== "network") {
        if (screen === "idle" || screen === "pin" || screen === "retrieved" || screen === "error") showError("network");
      }
      return;
    }
    if (screen === "error" && errorKind === "network") reset();
    if (screen === "idle" && printer !== "ready") showError(STATE_TO_ERROR[printer] ?? "print_failed");
    if (screen === "error" && printer === "ready" && !order && ["printer_offline", "paper_out", "paper_jam", "print_failed"].includes(errorKind)) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, printer, screen]);

  /* Inactivity return-to-start */
  useEffect(() => {
    const id = setInterval(() => {
      const s = screenRef.current;
      if ((s === "pin" || s === "retrieved") && Date.now() - lastTouch.current > 60000) reset();
    }, 2000);
    return () => clearInterval(id);
  }, [reset]);

  /* Job polling while printing */
  useEffect(() => {
    if (screen !== "printing" || !order) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/kiosk/jobs/${order.orderId}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as KOrder;
        if (!alive) return;
        setOrder(j);
        if (j.status === "completed") {
          setSecondsLeft(25);
          setScreen("completed");
        } else if (j.status === "failed") {
          showError(FAIL_TO_ERROR[j.failureReason ?? "error"] ?? "print_failed");
        }
      } catch {
        if (alive) setOnline(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [screen, order?.orderId, showError]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Completed countdown */
  useEffect(() => {
    if (screen !== "completed") return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          reset();
          return 25;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen, reset]);

  /* ---------- PIN ---------- */
  const pressKey = useCallback(
    (d: string) => {
      touch();
      setPinState("entering");
      setDigits((v) => (v.length < 4 ? v + d : v));
    },
    [touch],
  );

  const confirm = useCallback(async () => {
    if (digits.length !== 4 || pinState === "checking") return;
    touch();
    setPinState("checking");
    try {
      const r = await fetch("/api/kiosk/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: digits }),
      });
      const j = await r.json();
      if (r.ok) {
        setPinState("ok");
        const o = j as KOrder;
        setOrder(o);
        setTimeout(() => {
          if (o.status === "printing") setScreen("printing");
          else if (o.status === "failed") showError(FAIL_TO_ERROR[o.failureReason ?? "error"] ?? "print_failed");
          else setScreen("retrieved");
        }, 900);
        return;
      }
      if (r.status === 410) return showError("expired_pin");
      if (r.status === 429) {
        setPinState("locked");
        return;
      }
      const n = attempts + 1;
      setAttempts(n);
      if (n >= 3) {
        showError("invalid_pin");
        setDigits("");
        setPinState("entering");
      } else {
        setPinState("invalid");
        setTimeout(() => {
          setDigits("");
          setPinState("entering");
        }, 1100);
      }
    } catch {
      setOnline(false);
    }
  }, [digits, pinState, attempts, touch, showError]);

  useEffect(() => {
    if (screen !== "pin") return;
    const on = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressKey(e.key);
      else if (e.key === "Backspace") setDigits((v) => v.slice(0, -1));
      else if (e.key === "Enter") void confirm();
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [screen, pressKey, confirm, reset]);

  /* ---------- Job actions ---------- */
  async function jobAction(action: "start" | "resume") {
    if (!order) return;
    touch();
    setBusy(true);
    try {
      const r = await fetch(`/api/kiosk/jobs/${order.orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (r.status === 409) {
        showError(STATE_TO_ERROR[j.error] ?? "print_failed");
        return;
      }
      if (r.ok) {
        setOrder(j as KOrder);
        setScreen("printing");
      }
    } catch {
      setOnline(false);
    } finally {
      setBusy(false);
    }
  }

  async function errorPrimary() {
    touch();
    if (errorKind === "invalid_pin") {
      setAttempts(0);
      setDigits("");
      setPinState("entering");
      return setScreen("pin");
    }
    if (errorKind === "expired_pin") return reset();
    if (errorKind === "network") {
      setBusy(true);
      try {
        const r = await fetch("/api/kiosk/status", { cache: "no-store" });
        if (r.ok) {
          setOnline(true);
          reset();
        }
      } catch {
        /* still offline */
      }
      return setBusy(false);
    }
    // printer faults: re-check state, resume a saved job if there is one
    setBusy(true);
    try {
      const r = await fetch("/api/kiosk/status", { cache: "no-store" });
      const j = await r.json();
      setPrinter(j.state);
      if (j.state === "ready") {
        if (order && (order.status === "failed" || order.status === "pin_accepted")) {
          await jobAction(order.status === "failed" ? "resume" : "start");
        } else reset();
      }
    } catch {
      setOnline(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onPointerDown={touch} className="h-full w-full">
      {screen === "idle" && (
        <IdleScreen
          printer={printer}
          url={`${origin}/print`}
          onStart={() => {
            touch();
            setDigits("");
            setPinState("entering");
            setAttempts(0);
            setScreen("pin");
          }}
        />
      )}
      {screen === "pin" && (
        <PinScreen
          digits={digits}
          state={pinState}
          attemptsLeft={3 - attempts}
          printer={printer}
          onKey={pressKey}
          onBackspace={() => {
            touch();
            setDigits((v) => v.slice(0, -1));
          }}
          onClear={() => {
            touch();
            setDigits("");
          }}
          onConfirm={confirm}
          onCancel={reset}
        />
      )}
      {screen === "retrieved" && order && <RetrievedScreen order={order} printer={printer} onStart={() => jobAction("start")} onCancel={reset} />}
      {screen === "printing" && order && <PrintingScreen order={order} printer={printer} />}
      {screen === "completed" && order && <CompletedScreen order={order} secondsLeft={secondsLeft} onDone={reset} />}
      {screen === "error" && <ErrorScreen kind={errorKind} order={order} message={errorMsg} busy={busy} onPrimary={errorPrimary} onSecondary={reset} />}
      {busy && screen === "retrieved" && <div className="absolute inset-0 bg-white/30" />}
    </div>
  );
}
