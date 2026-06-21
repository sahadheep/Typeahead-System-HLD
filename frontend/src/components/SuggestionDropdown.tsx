import React from "react";
import type { Suggestion } from "../api/client";

interface SuggestionDropdownProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  prefix: string;
  mode: "count" | "trending";
  onModeChange: (mode: "count" | "trending") => void;
  onSelect: (query: string) => void;
  cacheHit?: boolean;
  cacheNode?: string;
  cachePort?: number;
  latencyMs?: number;
  isError?: boolean;
  isEmpty?: boolean;
}

/** Highlight the matching prefix in a suggestion query */
function HighlightedQuery({
  query,
  prefix,
}: {
  query: string;
  prefix: string;
}) {
  if (!prefix || !query.toLowerCase().startsWith(prefix.toLowerCase())) {
    return <span>{query}</span>;
  }
  return (
    <span>
      <mark>{query.slice(0, prefix.length)}</mark>
      {query.slice(prefix.length)}
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export const SuggestionDropdown = React.forwardRef<
  HTMLDivElement,
  SuggestionDropdownProps
>(
  (
    {
      suggestions,
      selectedIndex,
      prefix,
      mode,
      onModeChange,
      onSelect,
      cacheHit,
      cacheNode,
      cachePort,
      latencyMs,
      isError,
      isEmpty,
    },
    ref
  ) => {
    return (
      <div className="dropdown" ref={ref} role="listbox" aria-label="Suggestions">
        {/* Header row: label + mode toggle */}
        <div className="dropdown-header">
          <span className="dropdown-label">Suggestions</span>
          <div className="mode-toggle" role="group" aria-label="Ranking mode">
            <button
              id="mode-count"
              className={`mode-btn ${mode === "count" ? "active" : ""}`}
              onClick={() => onModeChange("count")}
              aria-pressed={mode === "count"}
            >
              Popular
            </button>
            <button
              id="mode-trending"
              className={`mode-btn ${mode === "trending" ? "active" : ""}`}
              onClick={() => onModeChange("trending")}
              aria-pressed={mode === "trending"}
            >
              🔥 Trending
            </button>
          </div>
        </div>

        {/* Body */}
        {isError ? (
          <div className="dropdown-error" role="alert">
            <span>⚠️</span>
            <span>Could not reach the server. Is the backend running?</span>
          </div>
        ) : isEmpty ? (
          <div className="dropdown-empty">
            <div className="empty-icon">🔍</div>
            <p>No matches for &ldquo;{prefix}&rdquo;</p>
          </div>
        ) : (
          <ul className="suggestion-list">
            {suggestions.map((s, i) => (
              <li
                key={s.query}
                id={`suggestion-${i}`}
                className={`suggestion-item ${i === selectedIndex ? "selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s.query);
                }}
              >
                <div className="suggestion-icon" aria-hidden="true">
                  🔎
                </div>
                <div className="suggestion-text">
                  <div className="suggestion-query">
                    <HighlightedQuery query={s.query} prefix={prefix} />
                  </div>
                  <div className="suggestion-count">
                    {formatCount(s.count)} searches
                    {mode === "trending" && (
                      <span style={{ marginLeft: 6, color: "#f06292" }}>
                        · score {s.score.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="suggestion-arrow" aria-hidden="true">↵</span>
              </li>
            ))}
          </ul>
        )}

        {/* Cache meta footer */}
        {cacheHit !== undefined && (
          <div className="cache-meta" aria-label="Cache info">
            <span className={`cache-hit-badge ${cacheHit ? "hit" : "miss"}`}>
              {cacheHit ? "✓ Cache Hit" : "✗ Cache Miss"}
            </span>
            {cacheNode && (
              <span>{cacheNode} :{cachePort}</span>
            )}
            {latencyMs !== undefined && (
              <span style={{ marginLeft: "auto" }}>{latencyMs}ms</span>
            )}
          </div>
        )}
      </div>
    );
  }
);

SuggestionDropdown.displayName = "SuggestionDropdown";
