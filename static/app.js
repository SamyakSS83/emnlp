const totalPhrases = window.APP_CONFIG.totalPhrases;
const phraseIndexInput = document.getElementById("phraseIndex");
const jumpBtn = document.getElementById("jumpBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const addIdiomaticBtn = document.getElementById("addIdiomaticBtn");
const addLiteralBtn = document.getElementById("addLiteralBtn");
const submitBtn = document.getElementById("submitBtn");
const sentenceList = document.getElementById("sentenceList");
const phraseTitle = document.getElementById("phraseTitle");
const phraseMeaning = document.getElementById("phraseMeaning");
const phraseBadge = document.getElementById("phraseBadge");
const recordStatus = document.getElementById("recordStatus");
const draftStatus = document.getElementById("draftStatus");

const statDone = document.getElementById("statDone");
const statPending = document.getElementById("statPending");
const statApproved = document.getElementById("statApproved");
const statEdited = document.getElementById("statEdited");

// Transliteration tool elements
const transiterationInput = document.getElementById("transiterationInput");
const convertBtn = document.getElementById("convertBtn");
const copyResultBtn = document.getElementById("copyResultBtn");
const transiterationStatus = document.getElementById("transiterationStatus");
const conversionResult = document.getElementById("conversionResult");
const convertedText = document.getElementById("convertedText");

let currentIndex = 1;
let currentRecord = null;
let draft = null;

function storageKey(index) {
  return `human-verif-draft-${index}`;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadStoredDraft(index) {
  const raw = localStorage.getItem(storageKey(index));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredDraft() {
  if (!draft) return;
  localStorage.setItem(storageKey(currentIndex), JSON.stringify(draft));
}

function setDraftStatus(message) {
  draftStatus.textContent = message;
}

function setRecordStatus(message) {
  recordStatus.textContent = message;
}

function syncStats(stats) {
  if (!stats) return;
  statDone.textContent = stats.reviewed_phrases;
  statPending.textContent = stats.pending_phrases;
  statApproved.textContent = stats.approved_items;
  statEdited.textContent = stats.edited_items;
}

function updateNavButtons() {
  prevBtn.disabled = currentIndex <= 1;
  nextBtn.disabled = currentIndex >= totalPhrases;
}

function ensurePhraseBounds(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), totalPhrases);
}

function makeItemCard(item, index) {
  const card = document.createElement("div");
  card.className = "sentence-card";
  card.dataset.key = item.key || `extra-${index}`;
  card.dataset.kind = item.kind;
  card.dataset.extra = item.extra ? "true" : "false";

  const top = document.createElement("div");
  top.className = "sentence-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "sentence-title";
  title.textContent = item.label;
  if (item.extra) {
    const tag = document.createElement("span");
    tag.className = "extra-tag";
    tag.textContent = `added ${item.kind}`;
    title.appendChild(tag);
  }
  const meta = document.createElement("div");
  meta.className = "sentence-meta";
  meta.textContent = item.kind;
  left.appendChild(title);
  left.appendChild(meta);
  top.appendChild(left);

  const status = document.createElement("div");
  status.className = "badge";
  status.textContent = item.decision ? item.decision : "untouched";
  status.dataset.status = "pill";
  top.appendChild(status);
  card.appendChild(top);

  const body = document.createElement("div");
  body.className = "sentence-body";
  body.textContent = item.source_sentence || item.sentence || "";
  card.appendChild(body);

  const textarea = document.createElement("textarea");
  textarea.placeholder = item.kind === "literal" ? "Review or edit this literal sentence..." : "Review or edit this idiomatic sentence...";
  textarea.value = item.edited_sentence || item.source_sentence || item.sentence || "";
  textarea.disabled = item.decision !== "edit";
  textarea.addEventListener("input", () => {
    item.edited_sentence = textarea.value;
    item.touched = true;
    setDraftStatus("Draft updated locally.");
  });
  card.appendChild(textarea);

  const decisions = document.createElement("div");
  decisions.className = "decision-group";

  const buttons = [
    { label: "Approve", value: "approve" },
    { label: "Reject", value: "reject" },
    { label: "Edit", value: "edit" },
  ];

  buttons.forEach(({ label, value }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (item.decision === value) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      item.decision = value;
      item.approved = value === "approve";
      item.touched = true;
      textarea.disabled = value !== "edit";
      if (value !== "edit") {
        textarea.value = item.source_sentence || item.sentence || "";
        item.edited_sentence = "";
      }
      if (value === "edit" && !textarea.value.trim()) {
        textarea.focus();
      }
      renderDraft();
      setDraftStatus("Draft updated locally.");
      saveStoredDraft();
    });
    decisions.appendChild(btn);
  });

  card.appendChild(decisions);
  return card;
}

function rebuildDraftFromPayload(payload) {
  const generated = payload.generated;
  const review = payload.review || {};

  const baseItems = [
    { key: "idiomatic_1", kind: "idiomatic", label: "Idiomatic 1", source_sentence: generated.idiomatic_1?.sentence || "" },
    { key: "idiomatic_2", kind: "idiomatic", label: "Idiomatic 2", source_sentence: generated.idiomatic_2?.sentence || "" },
    { key: "literal_1", kind: "literal", label: "Literal 1", source_sentence: generated.literal_1?.sentence || "" },
    { key: "literal_2", kind: "literal", label: "Literal 2", source_sentence: generated.literal_2?.sentence || "" },
  ];

  const itemMap = new Map((review.items || []).map((item) => [item.key, item]));
  const extras = Array.isArray(review.extras) ? review.extras : [];

  return {
    source_index: payload.index,
    phrase: review.phrase || generated.phrase,
    meaning: review.meaning || generated.meaning,
    items: baseItems.map((base, idx) => ({
      ...base,
      sentence: base.source_sentence,
      approved: false,
      decision: "",
      edited_sentence: "",
      touched: false,
      ...(itemMap.get(base.key) || {}),
      index: idx,
    })),
    extras: extras.map((extra, idx) => ({
      key: extra.key || `extra-${idx}`,
      kind: extra.kind,
      label: extra.label || `${extra.kind === "literal" ? "Literal" : "Idiomatic"} extra ${idx + 1}`,
      source_sentence: extra.source_sentence || "",
      sentence: extra.sentence || extra.source_sentence || "",
      approved: extra.approved ?? false,
      decision: extra.decision || "",
      edited_sentence: extra.edited_sentence || "",
      touched: extra.touched ?? false,
      extra: true,
    })),
  };
}

function renderDraft() {
  if (!draft) return;

  phraseTitle.textContent = draft.phrase;
  phraseMeaning.textContent = draft.meaning;
  phraseBadge.textContent = `${currentIndex} / ${totalPhrases}`;

  sentenceList.innerHTML = "";
  [...draft.items, ...draft.extras].forEach((item, index) => {
    sentenceList.appendChild(makeItemCard(item, index));
  });

  updateNavButtons();
  saveStoredDraft();
}

async function loadStats() {
  const response = await fetch("/api/stats");
  if (!response.ok) return;
  const stats = await response.json();
  syncStats(stats);
}

async function loadPhrase(index, { fromNav = false } = {}) {
  currentIndex = ensurePhraseBounds(index);
  phraseIndexInput.value = String(currentIndex);
  setRecordStatus(`Loading phrase ${currentIndex}...`);

  const response = await fetch(`/api/phrase/${currentIndex}`);
  if (!response.ok) {
    setRecordStatus("Phrase not found.");
    return;
  }

  const payload = await response.json();
  const storedDraft = loadStoredDraft(currentIndex);
  draft = rebuildDraftFromPayload(payload);

  if (storedDraft) {
    draft = {
      ...draft,
      ...storedDraft,
      items: draft.items.map((baseItem) => {
        const fromStored = (storedDraft.items || []).find((item) => item.key === baseItem.key);
        return fromStored ? { ...baseItem, ...fromStored } : baseItem;
      }),
      extras: Array.isArray(storedDraft.extras) && storedDraft.extras.length
        ? storedDraft.extras
        : draft.extras,
    };
    setDraftStatus("Draft restored from local storage.");
  } else {
    setDraftStatus("Draft staged locally. Nothing is saved yet.");
  }

  currentRecord = payload;
  renderDraft();
  setRecordStatus(fromNav ? `Opened phrase ${currentIndex}.` : `Loaded phrase ${currentIndex}.`);
}

function markAllTouchedIfNeeded() {
  return [...draft.items, ...draft.extras].some((item) => item.touched);
}

function addExtra(kind) {
  if (!draft) return;

  const idx = draft.extras.length + 1;
  draft.extras.push({
    key: `extra-${kind}-${Date.now()}-${idx}`,
    kind,
    label: `${kind === "literal" ? "Literal" : "Idiomatic"} extra ${idx}`,
    source_sentence: "",
    sentence: "",
    approved: false,
    decision: "edit",
    edited_sentence: "",
    touched: true,
    extra: true,
  });
  renderDraft();
  setDraftStatus(`Added a new ${kind} row.`);
}

async function submitReview() {
  if (!draft) return;
  if (!markAllTouchedIfNeeded()) {
    setRecordStatus("Interact with at least one sentence before submitting.");
    return;
  }

  const payload = clone(draft);
  const response = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_index: currentIndex,
      review: payload,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    setRecordStatus(result.message || "Could not save review.");
    return;
  }

  localStorage.removeItem(storageKey(currentIndex));
  setRecordStatus(`Saved phrase ${currentIndex} to human_verif.jsonl.`);
  setDraftStatus("Draft cleared from local storage after submit.");
  syncStats(result.stats);
  await loadPhrase(currentIndex, { fromNav: true });
}

jumpBtn.addEventListener("click", () => loadPhrase(ensurePhraseBounds(phraseIndexInput.value), { fromNav: true }));
phraseIndexInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadPhrase(ensurePhraseBounds(phraseIndexInput.value), { fromNav: true });
  }
});
prevBtn.addEventListener("click", () => loadPhrase(currentIndex - 1, { fromNav: true }));
nextBtn.addEventListener("click", () => loadPhrase(currentIndex + 1, { fromNav: true }));
addIdiomaticBtn.addEventListener("click", () => addExtra("idiomatic"));
addLiteralBtn.addEventListener("click", () => addExtra("literal"));
submitBtn.addEventListener("click", submitReview);

// Transliteration logic
function convertTransliteration() {
  const input = transiterationInput.value.trim();
  if (!input) {
    transiterationStatus.textContent = "Enter English Hindi text first.";
    conversionResult.style.display = "none";
    return;
  }

  transiterationStatus.textContent = "Converting...";
  
  fetch("/api/transliterate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input }),
  })
    .then((response) => response.json())
    .then((result) => {
      if (result.ok) {
        convertedText.textContent = result.converted;
        conversionResult.style.display = "flex";
        transiterationStatus.textContent = "✓ Converted successfully!";
        setTimeout(() => {
          transiterationStatus.textContent = "";
        }, 3000);
      } else {
        transiterationStatus.textContent = `Error: ${result.error}`;
      }
    })
    .catch((error) => {
      transiterationStatus.textContent = "Conversion failed. Check your input.";
      console.error("Transliteration error:", error);
    });
}

function copyToClipboard() {
  const text = convertedText.textContent;
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    transiterationStatus.textContent = "✓ Copied to clipboard!";
    setTimeout(() => {
      transiterationStatus.textContent = "";
    }, 2000);
  }).catch((error) => {
    transiterationStatus.textContent = "Copy failed. Try manually.";
    console.error("Clipboard error:", error);
  });
}

convertBtn.addEventListener("click", convertTransliteration);
copyResultBtn.addEventListener("click", copyToClipboard);
transiterationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    convertTransliteration();
  }
});

loadStats().catch(() => {});
loadPhrase(1).catch((error) => {
  console.error(error);
  setRecordStatus("Failed to load phrases.");
});