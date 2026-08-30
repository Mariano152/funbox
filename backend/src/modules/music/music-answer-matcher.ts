const EDITORIAL_WORDS = new Set([
  "official", "music", "video", "audio", "lyrics", "lyric", "visualizer", "visualiser",
  "hd", "uhd", "4k", "8k", "hq", "mv", "clip", "version", "remaster", "remastered",
]);

function ascii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'");
}

function normalizedTokens(value: string) {
  return ascii(value)
    .replace(/\bofficial\s+(?:music\s+)?video\b/g, " ")
    .replace(/\b(?:official\s+)?(?:audio|lyric\s+video|lyrics?|visuali[sz]er)\b/g, " ")
    .replace(/\b(?:hd|uhd|4k|8k|hq)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalized(value: string) {
  return normalizedTokens(value).join(" ");
}

function withoutParentheticals(value: string) {
  let previous = value;
  let current = value.replace(/\([^()]*\)|\[[^[\]]*\]/g, " ");
  while (current !== previous) {
    previous = current;
    current = current.replace(/\([^()]*\)|\[[^[\]]*\]/g, " ");
  }
  return current;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function fuzzyEqual(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  const longest = Math.max(left.length, right.length);
  const tolerance = longest >= 10 ? 2 : longest >= 7 ? 1 : 0;
  return editDistance(left, right) <= tolerance;
}

function containsThreeWordRun(candidate: string[], expected: string[]) {
  if (candidate.length < 3 || expected.length < 3) return false;
  const candidateText = ` ${candidate.join(" ")} `;
  for (let index = 0; index <= expected.length - 3; index += 1) {
    const run = expected.slice(index, index + 3);
    if (run.every((word) => !EDITORIAL_WORDS.has(word)) &&
        candidateText.includes(` ${run.join(" ")} `)) return true;
  }
  return false;
}

function titleVariants(value: string) {
  const variants = [normalized(value), normalized(withoutParentheticals(value))];
  return [...new Set(variants.filter(Boolean))];
}

export function matchesSongAnswer(candidate: string, expected: string) {
  const candidates = titleVariants(candidate);
  const expectedVariants = titleVariants(expected);
  if (!candidates.length || !expectedVariants.length) return false;
  return candidates.some((candidateVariant) => expectedVariants.some((expectedVariant) =>
    fuzzyEqual(candidateVariant, expectedVariant) ||
    containsThreeWordRun(candidateVariant.split(" "), expectedVariant.split(" ")),
  ));
}

function artistVariants(value: string) {
  const complete = normalized(value);
  const collaborators = value
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/gi, ",")
    .split(/\s*(?:,|;|&|\+|\/|\bx\b|\band\b|\by\b)\s*/i)
    .map(normalized)
    .filter(Boolean);
  return [...new Set([complete, ...collaborators].filter(Boolean))];
}

export function matchesArtistAnswer(candidate: string, expected: string) {
  const candidateVariants = artistVariants(candidate);
  const expectedVariants = artistVariants(expected);
  if (!candidateVariants.length || !expectedVariants.length) return false;
  return candidateVariants.some((candidateVariant) =>
    expectedVariants.some((expectedVariant) => fuzzyEqual(candidateVariant, expectedVariant)),
  );
}
