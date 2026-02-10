(function attachTimeUtils(global) {
  /**
   * Convert seconds to m:ss.
   * @param {number} seconds
   * @returns {string}
   */
  function formatTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Parse user-entered time values used by loop editing.
   * Accepted formats:
   * - ss (seconds)
   * - m:ss
   * - h:mm:ss
   *
   * @param {string} value
   * @returns {number|null} Seconds, or null for invalid input.
   */
  function parseTimeInput(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    if (text.includes(':')) {
      const parts = text.split(':').map((part) => part.trim());
      if (parts.some((part) => part === '' || Number.isNaN(Number(part)))) return null;

      if (parts.length === 2) {
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        if (minutes < 0 || seconds < 0) return null;
        return minutes * 60 + seconds;
      }

      if (parts.length === 3) {
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        const seconds = Number(parts[2]);
        if (hours < 0 || minutes < 0 || seconds < 0) return null;
        return hours * 3600 + minutes * 60 + seconds;
      }

      return null;
    }

    const seconds = Number(text);
    if (Number.isNaN(seconds) || seconds < 0) return null;
    return seconds;
  }

  global.VisualPianoTimeUtils = { formatTime, parseTimeInput };
})(window);
