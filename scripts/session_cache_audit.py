#!/usr/bin/env python3
"""Report which DSH sessions paid a full-prefix re-bill, and why.

A re-bill is one request whose entire surface went in uncached because the leading
system node changed: cacheReadTokens collapses toward zero while totalTokens stays
large. Every other request in the same sessions sits at 97-100%.

Attribution reads the session log itself. A system/message event within a few events
of the request means the prompt (tool docs, MCP declarations, skills) had just
changed — the cause DSH cannot avoid without a route that declares
systemPromptUpdate: 'in-history'. Anything else is an expired provider cache.

Credits: 0.06005/K uncached input at weekday peak (09:00-12:00, 14:00-18:00
Asia/Shanghai), half that off-peak — the catalog's creditMultiplier 0.11 plus the
night discount, cross-checked against request-usage exports.

Why python: node's zstdDecompressSync decodes only the FIRST frame of these logs;
python's compression.zstd.decompress walks all of them.

Usage: python scripts/session_cache_audit.py [--min-surface 100000] [--json]
"""
import json
import os
import sys
import datetime

import compression.zstd as zstd

DSH_HOME = os.environ.get("DSH_HOME", r"D:/AIAgents_Data/DSH_DATA")
SESSIONS = os.path.join(DSH_HOME, "sessions")
PEAK_CREDITS_PER_K = 0.06005


def stamp(ms):
    """Asia/Shanghai wall clock and the peak flag that prices it."""
    local = datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC) + datetime.timedelta(hours=8)
    weekday, hour = local.weekday(), local.hour
    peak = weekday < 5 and (9 <= hour < 12 or 14 <= hour < 18)
    return local.strftime("%m-%d %H:%M"), peak


def read_events(path):
    """Every durable event of one session log; a torn trailing line is dropped."""
    text = zstd.decompress(open(path, "rb").read()).decode("utf-8", "replace")
    events = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    return events


def audit(min_surface):
    rebills, sessions = [], []
    for workspace in sorted(os.listdir(SESSIONS)):
        workspace_path = os.path.join(SESSIONS, workspace)
        if not os.path.isdir(workspace_path):
            continue
        for session_dir in sorted(os.listdir(workspace_path)):
            session_path = os.path.join(workspace_path, session_dir)
            if not os.path.isdir(session_path):
                continue
            label = workspace.strip("-")[:22] + "/" + session_dir.replace("session-", "")[:8]
            for name in os.listdir(session_path):
                if not name.endswith(".jsonl.zstd") or "bak" in name:
                    continue
                try:
                    events = read_events(os.path.join(session_path, name))
                except Exception:
                    continue
                prompt_seqs = [e.get("seq") for e in events if e.get("type") == "system/message"]
                requests = billed = surface = 0
                previous_seq = None
                for event in events:
                    if event.get("type") != "assistant/message":
                        continue
                    usage = (event.get("data") or {}).get("usage") or {}
                    total = usage.get("totalTokens") or 0
                    read = usage.get("cacheReadTokens") or 0
                    requests += 1
                    billed += usage.get("inputTokens") or 0
                    surface += total
                    near_change = any(s < event.get("seq", 0) and event.get("seq", 0) - s < 8 for s in prompt_seqs)
                    if previous_seq is not None and total >= min_surface and read / max(total, 1) < 0.05:
                        uncached = usage.get("inputTokens") or (total - read)
                        when, peak = stamp(event["time"])
                        rebills.append({
                            "when": when,
                            "session": label,
                            "turn": (event.get("data") or {}).get("turn"),
                            "uncached": uncached,
                            "surface": total,
                            "credits": round(uncached / 1000 * PEAK_CREDITS_PER_K * (1 if peak else 0.5), 2),
                            "cause": "prompt-changed" if near_change else "cache-expired",
                        })
                    previous_seq = event.get("seq")
                if requests:
                    sessions.append({"label": label, "requests": requests,
                                     "cache_share": round((1 - billed / max(surface, 1)) * 100, 1)})
    # A seeded session replays its source's log, so one real re-bill shows up in both.
    # Same wall clock and same uncached count is the same request: keep it once.
    deduped, seen = [], set()
    for row in sorted(rebills, key=lambda r: -r["credits"]):
        key = (row["when"], row["uncached"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return sessions, deduped


def main():
    argv = sys.argv[1:]
    min_surface = int(argv[argv.index("--min-surface") + 1]) if "--min-surface" in argv else 100_000
    sessions, rebills = audit(min_surface)
    if "--json" in argv:
        print(json.dumps({"sessions": sessions, "rebills": rebills}, ensure_ascii=False, indent=2))
        return
    print("sessions scanned:", len(sessions))
    for s in sorted(sessions, key=lambda x: -x["requests"])[:8]:
        print("  %-32s reqs %5d   cache %5.1f%%" % (s["label"], s["requests"], s["cache_share"]))
    total = sum(r["credits"] for r in rebills)
    by_cause = {}
    for r in rebills:
        by_cause[r["cause"]] = round(by_cause.get(r["cause"], 0) + r["credits"], 1)
    print()
    print("re-billed requests: %d   estimated credits: %.1f" % (len(rebills), total))
    print("by cause:", json.dumps(by_cause, ensure_ascii=False))
    print()
    print("when            credits  uncached   surface  cause            session")
    for r in rebills:
        print("%-15s%7.2f  %8d  %8d  %-15s %s" % (r["when"], r["credits"], r["uncached"], r["surface"], r["cause"], r["session"]))


if __name__ == "__main__":
    main()
