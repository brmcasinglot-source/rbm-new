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
  const words = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
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

function getStudentName(lines) {
  const nameLabelIndex = lines.findIndex((line) =>
    /\b(?:(?:student|learner|full)\s+)?name\b\s*[:|]?/i.test(line)
  );
  if (nameLabelIndex >= 0) {
    const inlineName = lines[nameLabelIndex].replace(
      /^.*?\b(?:(?:student|learner|full)\s+)?name\b\s*[:|.-]?/i,
      ""
    ).trim();
    if (isPossibleNameLine(inlineName)) return inlineName;

    const followingLines = lines
      .slice(nameLabelIndex + 1, nameLabelIndex + 4)
      .filter(isPossibleNameLine);
    if (followingLines.length) return followingLines.join(" ");
  }

  const gradeIndex = lines.findIndex((line) =>
    /\bgrade\b/i.test(line) && /\b(?:7|8|9|10)\b/.test(line)
  );
  const learnerIdIndex = lines.findIndex((line) =>
    /learner.?s?\s+(?:id|number|no)\b/i.test(line)
  );
  const start = learnerIdIndex >= 0
    ? learnerIdIndex + 1
    : Math.max(0, (gradeIndex >= 0 ? gradeIndex : lines.length) - 4);
  const end = gradeIndex >= start ? gradeIndex : lines.length;
  const candidateLines = lines.slice(start, end).filter(isPossibleNameLine);
  return candidateLines.slice(learnerIdIndex >= 0 ? -3 : -2).join(" ");
}

export function parseStudentIdText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedText = lines.join("\n");
  const lrnLabel = /\bL\s*R\s*N\b/i.exec(normalizedText);
  const lrnContext = lrnLabel
    ? normalizedText.slice(lrnLabel.index + lrnLabel[0].length, lrnLabel.index + lrnLabel[0].length + 100)
      .replace(/\|/g, " ")
    : "";
  const lrnMatch = lrnContext.match(/[0-9OIl](?:[\s.-]*[0-9OIl]){11}/i);
  const lrn = lrnMatch
    ? lrnMatch[0].replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/\D/g, "")
    : "";

  const name = getStudentName(lines);
  const gradeAndSection = normalizedText.match(
    /\bGRADE\b[^\d\n]{0,8}(7|8|9|10)\s*[-|:]\s*([A-Z][A-Z '-]{1,35})/i
  );

  return {
    name: name.replace(/\s+/g, " ").trim(),
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
  const targets = [file];
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();

    for (const rotation of [90, 180, 270]) {
      const rotated = document.createElement("canvas");
      const context = rotated.getContext("2d");
      if (!context) continue;

      const quarterTurn = rotation === 90 || rotation === 270;
      rotated.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
      rotated.height = quarterTurn ? image.naturalWidth : image.naturalHeight;

      context.translate(rotated.width / 2, rotated.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.drawImage(
        image,
        -image.naturalWidth / 2,
        -image.naturalHeight / 2
      );

      const blob = await new Promise((resolve) => rotated.toBlob(resolve, "image/png"));
      if (blob) targets.push(new File([blob], `rotated-${rotation}.png`, { type: "image/png" }));
    }
  } catch {
    return targets;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }

  return targets;
}

export async function scanStudentIdFront(file) {
  const { default: tesseract } = await import("tesseract.js");
  let worker;
  let text = "";
  try {
    worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY);
    const recognitionTargets = await createStudentIdRecognitionTargets(file);

    for (const target of recognitionTargets) {
      const { data } = await worker.recognize(target);
      text = data.text;
      if (
        isCasinglotNationalHighSchoolId(text) &&
        parseStudentIdText(text).lrn
      ) {
        break;
      }
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
    throw new Error("Only Casinglot National High School IDs are accepted. Upload a front photo showing the school name.");
  }

  const details = parseStudentIdText(text);
  if (!details.name || !/^\d{12}$/.test(details.lrn)) {
    throw new Error("Could not read both the student name and 12-digit LRN. Please retake the front photo in clear lighting.");
  }
  return details;
}
