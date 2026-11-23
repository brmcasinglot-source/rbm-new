function normalizeNameTokens(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getEditDistance(first, second) {
  let previousRow = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const currentRow = [firstIndex];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      currentRow[secondIndex] = Math.min(
        previousRow[secondIndex] + 1,
        currentRow[secondIndex - 1] + 1,
        previousRow[secondIndex - 1] + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1)
      );
    }
    previousRow = currentRow;
  }
  return previousRow[second.length];
}

export function isCasinglotNationalHighSchoolId(text) {
  const normalizedText = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const words = normalizedText.split(/\s+/);
  const schoolName = "CASINGLOT NATIONAL HIGH SCHOOL";

  for (let index = 0; index <= words.length - 4; index += 1) {
    if (
      words[index] !== "CASINGLOT" ||
      words[index + 1] !== "NATIONAL" ||
      words[index + 2] !== "HIGH"
    ) {
      continue;
    }
    const candidate = words.slice(index, index + 4).join(" ");
    if (getEditDistance(candidate, schoolName) <= 4) return true;
  }
  return false;
}

function isPossibleNameLine(line) {
  const words = normalizeNameTokens(line);
  if (!words.length || words.length > 5 || /\d/.test(line)) return false;
  const excludedWords = new Set([
    "advisor", "casinglot", "deped", "grade", "high", "id", "learner",
    "lrn", "misamis", "national", "no", "number", "oriental", "reference",
    "school", "student", "tagoloan",
  ]);
  return !words.some((word) => excludedWords.has(word));
}

export function cleanStudentName(value) {
  let name = String(value || "")
    .replace(/[|]/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ .,'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return "";

  const commaParts = name.split(",");
  if (commaParts.length >= 2) {
    const surname = commaParts[0].trim();
    const givenNames = commaParts.slice(1).join(" ").trim();
    name = `${givenNames} ${surname}`.trim();
  }

  const noiseWords = new Set(["ne", "wn", "ve", "di", "a", "camensi"]);
  let tokens = name.split(/[\s]+/).filter(Boolean);
  tokens = tokens.filter((token) => {
    const normalized = normalizeNameTokens(token)[0];
    if (!normalized) return false;
    if (["name", "learner", "student", "lrn"].includes(normalized)) return false;
    if (noiseWords.has(normalized)) return false;
    return true;
  });

  if (tokens.length > 7) tokens = tokens.slice(-7);
  if (tokens.length < 2) return "";

  const firstToken = tokens[0].replace(/[.,'-]/g, "");
  if (
    /^[A-Z]{2,}$/.test(firstToken) &&
    tokens.slice(1).some((token) => /^[A-Za-zÀ-ÖØ-öø-ÿ]*[a-zÀ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ]*$/.test(token))
  ) {
    tokens = [...tokens.slice(1), tokens[0]];
  }

  const titleCase = (token) => token
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);

  return tokens.map((token) => {
    if (/^[A-Z]{2,}$/.test(token.replace(/[.,'-]/g, ""))) {
      return titleCase(token);
    }
    return titleCase(token);
  }).join(" ").replace(/\s+([,.])/g, "$1").trim();
}

function getStudentName(lines) {
  const commaNameIndex = lines.findIndex((line) =>
    /^[^,]{2,},/.test(line.trim()) &&
    isPossibleNameLine(line)
  );
  if (commaNameIndex >= 0) {
    const commaLine = lines[commaNameIndex].trim();
    const [, givenNamesOnLine = ""] = commaLine.split(/,(.*)$/);
    if (!givenNamesOnLine.trim() && commaNameIndex + 1 < lines.length) {
      const followingName = cleanStudentName(lines[commaNameIndex + 1]);
      if (isPossibleNameLine(followingName)) {
        const surname = commaLine.replace(/,$/, "").trim();
        return cleanStudentName(`${followingName} ${surname}`);
      }
    }
    return cleanStudentName(commaLine);
  }

  const nameLabelIndex = lines.findIndex((line) =>
    /\b(?:(?:student|learner|full)\s+)?name\b\s*[:|]?/i.test(line)
  );
  if (nameLabelIndex >= 0) {
    const inlineName = lines[nameLabelIndex].replace(
      /^.*?\b(?:(?:student|learner|full)\s+)?name\b\s*[:|.-]?/i,
      ""
    ).trim();
    const cleanedInlineName = cleanStudentName(inlineName);
    if (isPossibleNameLine(cleanedInlineName)) return cleanedInlineName;

    const followingLines = lines
      .slice(nameLabelIndex + 1, nameLabelIndex + 4)
      .map(cleanStudentName)
      .filter(isPossibleNameLine);
    if (followingLines.length) return cleanStudentName(followingLines.join(" "));
  }

  const gradeIndex = lines.findIndex((line) =>
    /\bgrade\b/i.test(line) && /\b(?:7|8|9|10)\b/.test(line)
  );
  if (gradeIndex >= 0) {
    const nameLines = lines
      .slice(Math.max(0, gradeIndex - 7), gradeIndex)
      .map((line) => line.replace(/\d+/g, " ").replace(/[^a-zA-Z\s'-]/g, " ").trim())
      .filter((line) => isPossibleNameLine(line));
    const name = nameLines.join(" ").replace(/\s+/g, " ").trim();
    if (normalizeNameTokens(name).length >= 2) return cleanStudentName(name);
  }

  const learnerIdIndex = lines.findIndex((line) =>
    /learner.?s?\s+(?:id|number|no)\b/i.test(line)
  );
  const start = learnerIdIndex >= 0
    ? learnerIdIndex + 1
    : Math.max(0, (gradeIndex >= 0 ? gradeIndex : lines.length) - 4);
  const end = gradeIndex >= start ? gradeIndex : lines.length;
  const candidateLines = lines.slice(start, end).filter(isPossibleNameLine);
  return cleanStudentName(candidateLines.slice(learnerIdIndex >= 0 ? -3 : -2).join(" "));
}

export function parseStudentIdText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedText = lines.join("\n");
  const lrnLabel = /\bL\s*[RPEI1]\s*N\b/i.exec(normalizedText);
  const lrnContext = lrnLabel
    ? normalizedText.slice(lrnLabel.index + lrnLabel[0].length, lrnLabel.index + lrnLabel[0].length + 100)
      .replace(/\|/g, " ")
    : normalizedText;
  const lrnMatch = lrnContext.match(/[0-9OIl](?:[\s.-]*[0-9OIl]){11}/i);
  const lrn = lrnMatch
    ? lrnMatch[0].replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/\D/g, "")
    : "";

  const name = getStudentName(lines)
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const gradeAndSection = normalizedText.match(
    /\bGRADE\b[^\d\n]{0,8}(7|8|9|10)\s*[-|:]\s*([A-Z][A-Z '-]{1,35})/i
  );

  return {
    name: cleanStudentName(name),
    lrn,
    grade: gradeAndSection ? `Grade ${gradeAndSection[1]}` : "",
    section: gradeAndSection ? gradeAndSection[2].trim().replace(/\s+/g, " ") : "",
  };
}

export function studentNamesMatch(firstName, secondName) {
  const first = normalizeNameTokens(firstName);
  const second = normalizeNameTokens(secondName);
  if (first.length < 2 || second.length < 2) return false;

  const unmatchedFirst = [...first];
  const unmatchedSecond = [...second];
  for (let index = unmatchedFirst.length - 1; index >= 0; index -= 1) {
    const matchingIndex = unmatchedSecond.indexOf(unmatchedFirst[index]);
    if (matchingIndex < 0) continue;
    unmatchedFirst.splice(index, 1);
    unmatchedSecond.splice(matchingIndex, 1);
  }

  for (const [source, target] of [
    [unmatchedFirst, unmatchedSecond],
    [unmatchedSecond, unmatchedFirst],
  ]) {
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (source[index].length !== 1) continue;
      const matchingIndex = target.findIndex((token) => token.startsWith(source[index]));
      if (matchingIndex >= 0) {
        source.splice(index, 1);
        target.splice(matchingIndex, 1);
      }
    }
  }

  const remainingInitials = (tokens) => tokens.filter((token) => token.length === 1).sort();
  const remainingNames = (tokens) => tokens.filter((token) => token.length > 1);
  if (remainingNames(unmatchedFirst).length || remainingNames(unmatchedSecond).length) return false;

  const firstInitials = remainingInitials(unmatchedFirst);
  const secondInitials = remainingInitials(unmatchedSecond);
  return !firstInitials.length || !secondInitials.length ||
    firstInitials.join(" ") === secondInitials.join(" ");
}

async function createStudentIdRecognitionTargets(file) {
  const targets = [];
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();

    for (const rotation of [0, 90, 180, 270]) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;

      const quarterTurn = rotation === 90 || rotation === 270;
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const sourceWidth = Math.round(image.naturalWidth * scale);
      const sourceHeight = Math.round(image.naturalHeight * scale);
      canvas.width = quarterTurn ? sourceHeight : sourceWidth;
      canvas.height = quarterTurn ? sourceWidth : sourceHeight;

      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.filter = "contrast(1.25)";
      context.drawImage(
        image,
        -sourceWidth / 2,
        -sourceHeight / 2,
        sourceWidth,
        sourceHeight
      );

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) {
        targets.push(new File([blob], `student-id-${rotation}.png`, { type: "image/png" }));
      }
    }
  } finally {
    URL.revokeObjectURL(imageUrl);
  }

  return targets;
}

export async function scanStudentIdFront(file) {
  const { default: tesseract } = await import("tesseract.js");
  let worker;
  let text = "";
  let bestScore = -1;
  try {
    worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY);
    const recognitionTargets = await createStudentIdRecognitionTargets(file);

    for (const target of recognitionTargets) {
      const { data } = await worker.recognize(target);
      if (!isCasinglotNationalHighSchoolId(data.text)) continue;

      const details = parseStudentIdText(data.text);
      const score =
        Number(Boolean(details.name)) +
        Number(Boolean(details.lrn)) +
        Number(Boolean(details.grade)) +
        Number(Boolean(details.section));
      if (score > bestScore) {
        text = data.text;
        bestScore = score;
      }
      if (score === 4) break;
    }
  } catch (error) {
    throw new Error(
      "Could not scan the ID. Check your connection and upload a clear front photo.",
      { cause: error }
    );
  } finally {
    if (worker) await worker.terminate();
  }

  if (!isCasinglotNationalHighSchoolId(text)) {
    throw new Error("This system is exclusively for students of Casinglot National High School.");
  }

  return parseStudentIdText(text);
}
