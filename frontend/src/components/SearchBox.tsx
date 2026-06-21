import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { fetchSuggestions, postSearch } from "../api/client";
import type { Suggestion, SuggestResponse } from "../api/client";
import { SuggestionDropdown } from "./SuggestionDropdown";


interface SearchResult {
  query: string;
  ts: number;
}

export function SearchBox() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"count" | "trending">("count");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meta, setMeta] = useState<SuggestResponse["meta"] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [lastResult, setLastResult] = useState<SearchResult | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedInput = useDebounce(input, 300);

  // ── Fetch suggestions when debounced input changes ─────────────────────
  useEffect(() => {
    const prefix = debouncedInput.trim();

    if (!prefix) {
      setSuggestions([]);
      setMeta(null);
      setIsError(false);
      setIsOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    fetchSuggestions(prefix, mode)
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.suggestions);
        setMeta(data.meta ?? null);
        setIsOpen(true);
        setSelectedIndex(-1);
      })
      .catch(() => {
        if (cancelled) return;
        setIsError(true);
        setIsOpen(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedInput, mode]);

  // ── Submit search ────────────────────────────────────────────────────
  const handleSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;

    setInput(q);
    setIsOpen(false);
    setSelectedIndex(-1);

    try {
      await postSearch(q);
      setLastResult({ query: q, ts: Date.now() });
      setRecentSearches((prev) => {
        const updated = [q, ...prev.filter((r) => r !== q)].slice(0, 8);
        return updated;
      });
    } catch {
      // Non-critical
    }
  }, []);

  // ── Keyboard navigation ──────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          void handleSearch(suggestions[selectedIndex]!.query);
        } else if (input.trim()) {
          void handleSearch(input.trim());
        }
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
      }
    },
    [isOpen, suggestions, selectedIndex, input, handleSearch]
  );

  // ── Close dropdown on outside click ──────────────────────────────────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleClear = () => {
    setInput("");
    setSuggestions([]);
    setIsOpen(false);
    setMeta(null);
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="search-container">
        <div className="search-box">
          {/* Search icon */}
          <svg
            className="search-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>

          <input
            id="search-input"
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0 || isError) setIsOpen(true);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls="suggestion-listbox"
            aria-activedescendant={
              selectedIndex >= 0 ? `suggestion-${selectedIndex}` : undefined
            }
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
          />

          {isLoading && <div className="loading-spinner" aria-label="Loading suggestions" />}
          {!isLoading && input && (
            <button
              className="clear-btn"
              onClick={handleClear}
              aria-label="Clear search"
              tabIndex={-1}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {isOpen && (
          <SuggestionDropdown
            ref={dropdownRef}
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            prefix={debouncedInput.trim()}
            mode={mode}
            onModeChange={(m) => { setMode(m); setIsOpen(false); }}
            onSelect={handleSearch}
            cacheHit={meta?.cacheHit}
            cacheNode={meta?.node}
            cachePort={meta?.port}
            latencyMs={meta?.latencyMs}
            isError={isError}
            isEmpty={!isError && suggestions.length === 0 && !!debouncedInput.trim()}
          />
        )}
      </div>

      {/* Last search result toast */}
      {lastResult && (
        <div className="result-toast" role="status" aria-live="polite">
          <div className="toast-icon">✓</div>
          <div className="toast-text">
            <strong>Searched for &ldquo;{lastResult.query}&rdquo;</strong>
            <span>Count incremented · cache invalidated for this prefix</span>
          </div>
        </div>
      )}

      {/* Recent searches */}
      {recentSearches.length > 0 && !isOpen && (
        <div className="recent-section">
          <div className="recent-label">Recent</div>
          <div className="recent-list">
            {recentSearches.map((q) => (
              <button
                key={q}
                className="recent-chip"
                onClick={() => {
                  setInput(q);
                  void handleSearch(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
