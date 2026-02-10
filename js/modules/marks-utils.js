(function attachMarksUtils(global) {
  /**
   * Insert a mark into an already-sorted mark list.
   *
   * @param {number[]} marks Sorted mark list, mutated in place.
   * @param {number} markSeconds
   * @param {number} [eps=0.001]
   * @returns {boolean} True if inserted, false if duplicate.
   */
  function insertSortedUniqueMark(marks, markSeconds, eps = 0.001) {
    for (let i = 0; i < marks.length; i++) {
      const existing = marks[i];
      if (Math.abs(existing - markSeconds) < eps) return false;
      if (existing > markSeconds) {
        marks.splice(i, 0, markSeconds);
        return true;
      }
    }
    marks.push(markSeconds);
    return true;
  }

  /**
   * Resolve the active loop segment from marks at a given playhead time.
   * Marks must be sorted ascending.
   *
   * @param {number[]} sortedMarks
   * @param {number} songTime
   * @param {number} totalDuration
   * @returns {{start:number,end:number}|null}
   */
  function resolveLoopSegmentFromMarks(sortedMarks, songTime, totalDuration) {
    if (!sortedMarks.length) return null;

    const first = sortedMarks[0];
    const last = sortedMarks[sortedMarks.length - 1];

    if (songTime <= first) {
      return { start: 0, end: first };
    }
    if (songTime >= last) {
      return { start: last, end: totalDuration };
    }

    for (let i = 0; i < sortedMarks.length - 1; i++) {
      if (songTime >= sortedMarks[i] && songTime <= sortedMarks[i + 1]) {
        return { start: sortedMarks[i], end: sortedMarks[i + 1] };
      }
    }

    return { start: last, end: totalDuration };
  }

  global.VisualPianoMarksUtils = { insertSortedUniqueMark, resolveLoopSegmentFromMarks };
})(window);
