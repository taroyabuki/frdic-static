(function () {
  "use strict";

  const WORDS_URL = "./words.json";
  const SEARCH_LIMIT = 100;
  const SUGGEST_LIMIT = 8;
  const NOUN_CATEGORIES = ["男性名詞", "女性名詞", "人名詞", "固有名詞"];
  const VERB_CATEGORIES = ["自動詞", "他動詞"];
  const CATEGORY_BUTTONS = [
    "名詞",
    "男性名詞",
    "女性名詞",
    "人名詞",
    "固有名詞",
    "動詞",
    "自動詞",
    "他動詞",
    "限定詞",
    "代名詞",
    "形容詞",
    "副詞",
    "前置詞",
    "接続詞",
    "間投詞",
    "数詞",
    "定型表現"
  ];
  const TENSES = [
    ["present", "現在形（直説法）"],
    ["imparfait", "半過去（直説法）"],
    ["future", "単純未来（直説法）"],
    ["passe_compose", "複合過去（直説法）"]
  ];
  const PERSON_LABELS = [
    "私（je）",
    "あなた（tu）",
    "彼/彼女（il/elle）",
    "私たち（nous）",
    "あなた方（vous）",
    "彼ら/彼女ら（ils/elles）"
  ];

  const els = {
    input: document.getElementById("q"),
    list: document.getElementById("suggestions"),
    form: document.getElementById("search-form"),
    rateSelect: document.getElementById("rate"),
    categoryBar: document.getElementById("category-bar"),
    results: document.getElementById("results")
  };

  let words = [];
  let wordSet = new Set();
  let wordCanonical = new Map();
  let wordNormCanonical = new Map();
  let activeIndex = -1;
  let currentItems = [];
  let suggestTimer = null;
  let warnedNoSynth = false;
  let warnedNoFrenchVoice = false;
  const synth = ("speechSynthesis" in window) ? window.speechSynthesis : null;

  init();

  function init() {
    initRateSelect();
    bindEvents();
    renderCategoryBar(readState());

    fetch(WORDS_URL)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("HTTP " + String(res.status));
        }
        return res.json();
      })
      .then(function (payload) {
        words = normalizePayload(payload);
        buildWordIndexes();
        applyUrlAndRender();
      })
      .catch(function () {
        showEmpty("辞書データを読み込めませんでした。");
      });
  }

  function initRateSelect() {
    if (!els.rateSelect) {
      return;
    }
    const saved = localStorage.getItem("tts_rate");
    if (saved && els.rateSelect.querySelector('option[value="' + cssEscape(saved) + '"]')) {
      els.rateSelect.value = saved;
    }
    els.rateSelect.addEventListener("change", function () {
      localStorage.setItem("tts_rate", els.rateSelect.value);
    });
  }

  function bindEvents() {
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      hideList();
      navigateToQuery(els.input.value);
    });

    els.input.addEventListener("input", function () {
      window.clearTimeout(suggestTimer);
      suggestTimer = window.setTimeout(fetchSuggestions, 120);
    });

    els.input.addEventListener("compositionend", function () {
      window.clearTimeout(suggestTimer);
      fetchSuggestions();
    });

    els.input.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (els.list.style.display !== "block") {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (activeIndex < currentItems.length - 1) {
          activeIndex += 1;
        }
        updateActiveSuggestion();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (activeIndex > 0) {
          activeIndex -= 1;
        }
        updateActiveSuggestion();
      } else if (e.key === "Enter") {
        const selected = getActiveSuggestionValue();
        if (selected) {
          e.preventDefault();
          selectSuggestion(selected);
        }
      } else if (e.key === "Escape") {
        hideList();
      }
    });

    document.addEventListener("click", function (e) {
      if (!els.list.contains(e.target) && e.target !== els.input) {
        hideList();
      }

      const nav = e.target.closest("a[data-nav]");
      if (nav) {
        e.preventDefault();
        hideList();
        navigateTo(nav.getAttribute("href") || "./");
        return;
      }

      const toggleBtn = e.target.closest(".toggle-conj-btn");
      if (toggleBtn) {
        const targetId = toggleBtn.getAttribute("data-target") || "";
        const panel = targetId ? document.getElementById(targetId) : null;
        if (!panel) {
          return;
        }
        const isOpen = panel.style.display !== "none";
        panel.style.display = isOpen ? "none" : "block";
        toggleBtn.textContent = isOpen ? "活用を表示" : "活用を隠す";
        toggleBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
        return;
      }

      const speakBtn = e.target.closest(".speak-btn");
      if (speakBtn) {
        const text = (speakBtn.getAttribute("data-speak") || "").trim();
        speakFrench(text, true);
      }
    });

    window.addEventListener("popstate", applyUrlAndRender);
  }

  function normalizePayload(payload) {
    const raw = payload && Array.isArray(payload.words) ? payload.words : [];
    return raw.map(function (row, index) {
      const conjugations = row.conjugations && typeof row.conjugations === "object" ? row.conjugations : {};
      const word = stringValue(row.word);
      return {
        id: Number.isFinite(Number(row.id)) ? Number(row.id) : index + 1,
        word: word,
        word_norm: stringValue(row.word_norm) || normalizeSearchKey(word),
        category: stringValue(row.category),
        meaning: stringValue(row.meaning),
        example_fr: stringValue(row.example_fr),
        example_ja: stringValue(row.example_ja),
        conjugations: {
          present: normalizeForms(conjugations.present),
          imparfait: normalizeForms(conjugations.imparfait),
          future: normalizeForms(conjugations.future),
          passe_compose: normalizeForms(conjugations.passe_compose)
        }
      };
    });
  }

  function normalizeForms(value) {
    if (!Array.isArray(value) || value.length !== 6) {
      return [];
    }
    const forms = value.map(stringValue);
    return forms.every(function (item) { return item !== ""; }) ? forms : [];
  }

  function stringValue(value) {
    return value == null ? "" : String(value);
  }

  function buildWordIndexes() {
    wordSet = new Set();
    wordCanonical = new Map();
    wordNormCanonical = new Map();
    words.forEach(function (row) {
      const w = row.word.trim();
      if (!w) {
        return;
      }
      wordSet.add(w);
      const lower = toLower(w);
      wordSet.add(lower);
      if (!wordCanonical.has(lower)) {
        wordCanonical.set(lower, w);
      }
      const norm = normalizeSearchKey(w);
      if (norm && !wordNormCanonical.has(norm)) {
        wordNormCanonical.set(norm, w);
      }
    });
  }

  function applyUrlAndRender() {
    const state = readState();
    els.input.value = state.q;
    renderCategoryBar(state);
    renderResults(state);
  }

  function readState() {
    const params = new URLSearchParams(window.location.search);
    return {
      q: (params.get("q") || "").trim(),
      cat: (params.get("cat") || "").trim(),
      exact: params.get("exact") === "1"
    };
  }

  function navigateTo(href) {
    const nextUrl = new URL(href, window.location.href);
    const current = window.location.pathname + window.location.search;
    const next = nextUrl.pathname + nextUrl.search;
    if (next !== current) {
      window.history.pushState({}, "", nextUrl);
    }
    applyUrlAndRender();
  }

  function navigateToQuery(value) {
    const q = stringValue(value).trim();
    navigateTo(q ? "?" + new URLSearchParams({ q: q }).toString() : "./");
  }

  function renderCategoryBar(state) {
    els.categoryBar.replaceChildren();
    CATEGORY_BUTTONS.forEach(function (category) {
      const link = document.createElement("a");
      const isNounMajor = category === "名詞";
      const isVerbMajor = category === "動詞";
      const isNounChild = NOUN_CATEGORIES.includes(category);
      const isVerbChild = VERB_CATEGORIES.includes(category);
      const isActive = isCategoryButtonActive(category, state.cat);
      const isExactActive = state.cat === category;

      link.className = "cat-btn"
        + ((isNounMajor || isVerbMajor) ? " cat-btn-major" : "")
        + (isActive ? " active" : "");
      link.href = isExactActive
        ? (state.q ? "?" + new URLSearchParams({ q: state.q }).toString() : "./")
        : "?" + new URLSearchParams({ cat: category }).toString();
      link.dataset.nav = "1";
      link.textContent = category;
      if (isNounChild || isVerbChild || isNounMajor || isVerbMajor) {
        link.setAttribute("aria-pressed", isActive ? "true" : "false");
      }
      els.categoryBar.appendChild(link);
    });
  }

  function isCategoryButtonActive(category, activeCat) {
    if (category === "名詞") {
      return activeCat === "名詞" || NOUN_CATEGORIES.includes(activeCat);
    }
    if (category === "動詞") {
      return activeCat === "動詞" || VERB_CATEGORIES.includes(activeCat);
    }
    if (NOUN_CATEGORIES.includes(category)) {
      return activeCat === category || activeCat === "名詞";
    }
    if (VERB_CATEGORIES.includes(category)) {
      return activeCat === category || activeCat === "動詞";
    }
    return activeCat === category;
  }

  function renderResults(state) {
    if (!words.length) {
      showEmpty("検索キーワードを入力してください。");
      return;
    }

    const rows = searchRows(state);
    if (!state.q && !state.cat) {
      showEmpty("検索キーワードを入力してください。");
      return;
    }
    if (!rows.length) {
      showEmpty("該当する語がありませんでした。");
      return;
    }

    const list = document.createElement("div");
    list.className = "result-list";
    rows.forEach(function (row, index) {
      list.appendChild(renderRow(row, index));
    });
    els.results.replaceChildren(list);
  }

  function searchRows(state) {
    let rows = [];
    if (!state.q && !state.cat) {
      return rows;
    }

    if (state.exact) {
      rows = words.filter(function (row) {
        return row.word === state.q;
      }).sort(compareWord).slice(0, SEARCH_LIMIT);
    } else if (state.cat) {
      rows = words.filter(function (row) {
        return categoryMatches(row.category, state.cat);
      }).sort(compareWord);
    } else if (isJapaneseInput(state.q)) {
      rows = words.filter(function (row) {
        return row.meaning.startsWith(state.q);
      }).sort(compareWord).slice(0, SEARCH_LIMIT);
    } else {
      const qNorm = normalizeSearchKey(state.q);
      if (qNorm) {
        rows = words.filter(function (row) {
          return row.word_norm.startsWith(qNorm);
        }).sort(compareWord).slice(0, SEARCH_LIMIT);
      }
    }
    return rows;
  }

  function categoryMatches(category, selected) {
    const c = category || "";
    if (selected === "名詞") {
      return NOUN_CATEGORIES.some(function (item) { return c.includes(item); });
    }
    if (selected === "動詞") {
      return VERB_CATEGORIES.some(function (item) { return c.includes(item); });
    }
    return c.includes(selected);
  }

  function compareWord(a, b) {
    if (a.word < b.word) {
      return -1;
    }
    if (a.word > b.word) {
      return 1;
    }
    return a.id - b.id;
  }

  function renderRow(row, index) {
    const article = document.createElement("article");
    article.className = "result-card";

    const mainLine = document.createElement("div");
    mainLine.className = "entry-line";
    mainLine.appendChild(makeSpeakButton(row.word));

    const mainText = document.createElement("div");
    mainText.className = "entry-main-text";
    mainText.appendChild(makeSpan("entry-word part", row.word));
    if (row.category) {
      mainText.appendChild(makeSpan("entry-cat part", row.category));
    }
    const meaning = makeSpan("entry-meaning part", "");
    appendLinkedText(meaning, row.meaning, row.word);
    mainText.appendChild(meaning);
    mainLine.appendChild(mainText);
    article.appendChild(mainLine);

    if (row.example_fr) {
      const subLine = document.createElement("div");
      subLine.className = "entry-subline";
      subLine.appendChild(makeSpeakButton(row.example_fr));

      const inline = document.createElement("div");
      inline.className = "entry-example-inline";
      const exampleFr = makeSpan("entry-example-fr", "");
      appendLinkedText(exampleFr, row.example_fr, row.word);
      inline.appendChild(exampleFr);
      if (row.example_ja) {
        inline.appendChild(makeSpan("entry-example-ja", row.example_ja));
      }
      subLine.appendChild(inline);
      article.appendChild(subLine);
    }

    const tenses = buildRowTenses(row);
    if (tenses.length) {
      const panelId = "conj-panel-" + String(index);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "toggle-conj-btn";
      toggle.setAttribute("data-target", panelId);
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "活用を表示";
      article.appendChild(toggle);

      const panel = document.createElement("div");
      panel.id = panelId;
      panel.className = "conj-panel";
      panel.style.display = "none";
      tenses.forEach(function (tense) {
        panel.appendChild(renderTense(tense));
      });
      article.appendChild(panel);
    }

    return article;
  }

  function makeSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function makeSpeakButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speak-btn";
    button.setAttribute("data-speak", text);
    button.setAttribute("aria-label", "再生");
    button.title = "再生";
    return button;
  }

  function buildRowTenses(row) {
    if (!isVerbCategory(row.category)) {
      return [];
    }
    const out = [];
    TENSES.forEach(function (item) {
      const key = item[0];
      const label = item[1];
      const forms = row.conjugations[key];
      if (Array.isArray(forms) && forms.length === 6) {
        out.push({ label: label, forms: forms });
      }
    });
    return out;
  }

  function renderTense(tense) {
    const wrap = document.createElement("div");
    wrap.className = "conj-wrap";
    const title = document.createElement("p");
    title.className = "conj-title";
    title.textContent = tense.label;
    wrap.appendChild(title);

    const table = document.createElement("table");
    table.className = "conj-table";
    const tbody = document.createElement("tbody");
    tense.forms.forEach(function (form, index) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      const td = document.createElement("td");
      th.textContent = PERSON_LABELS[index];
      td.textContent = form;
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function appendLinkedText(container, text, excludeWord) {
    if (!text || !wordSet.size) {
      container.textContent = text || "";
      return;
    }

    const excludeKey = excludeWord ? toLower(excludeWord) : "";
    const excludeNorm = excludeWord ? normalizeSearchKey(excludeWord) : "";
    const pattern = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[’'\-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/gu;
    let last = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[0];
      const pos = match.index;
      if (pos > last) {
        container.appendChild(document.createTextNode(text.slice(last, pos)));
      }

      let target = "";
      if (excludeKey && toLower(token) === excludeKey) {
        container.appendChild(document.createTextNode(token));
      } else {
        target = resolveTokenTarget(token);
        const targetNorm = target ? normalizeSearchKey(target) : "";
        if (target && excludeNorm && targetNorm === excludeNorm) {
          target = "";
        }
        if (target) {
          const a = document.createElement("a");
          a.href = "?" + new URLSearchParams({ q: target, exact: "1" }).toString();
          a.dataset.nav = "1";
          a.textContent = token;
          container.appendChild(a);
        } else {
          container.appendChild(document.createTextNode(token));
        }
      }
      last = pos + token.length;
    }
    if (last < text.length) {
      container.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function resolveTokenTarget(token) {
    const clean = token.trim();
    if (!clean) {
      return "";
    }
    const lower = toLower(clean);
    if (wordSet.has(clean)) {
      return clean;
    }
    if (wordSet.has(lower)) {
      return wordCanonical.get(lower) || lower;
    }

    const tokenNorm = normalizeSearchKey(clean);
    if (tokenNorm && wordNormCanonical.has(tokenNorm)) {
      return wordNormCanonical.get(tokenNorm);
    }

    const lemmas = guessFrenchLemmas(lower);
    for (let i = 0; i < lemmas.length; i += 1) {
      const lemmaNorm = normalizeSearchKey(lemmas[i]);
      if (lemmaNorm && wordNormCanonical.has(lemmaNorm)) {
        return wordNormCanonical.get(lemmaNorm);
      }
    }
    return "";
  }

  function guessFrenchLemmas(tokenLower) {
    const irregular = {
      suis: "être", es: "être", est: "être", sommes: "être", "êtes": "être", etes: "être", sont: "être",
      ai: "avoir", as: "avoir", a: "avoir", avons: "avoir", avez: "avoir", ont: "avoir",
      vais: "aller", vas: "aller", va: "aller", allons: "aller", allez: "aller", vont: "aller",
      fais: "faire", fait: "faire", faisons: "faire", faites: "faire", font: "faire",
      dis: "dire", dit: "dire", disons: "dire", dites: "dire", disent: "dire",
      prends: "prendre", prend: "prendre", prenons: "prendre", prenez: "prendre", prennent: "prendre",
      peux: "pouvoir", peut: "pouvoir", pouvons: "pouvoir", pouvez: "pouvoir", peuvent: "pouvoir",
      dois: "devoir", doit: "devoir", devons: "devoir", devez: "devoir", doivent: "devoir",
      veux: "vouloir", veut: "vouloir", voulons: "vouloir", voulez: "vouloir", veulent: "vouloir",
      vois: "voir", voit: "voir", voyons: "voir", voyez: "voir", voient: "voir",
      sais: "savoir", sait: "savoir", savons: "savoir", savez: "savoir", savent: "savoir",
      viens: "venir", vient: "venir", venons: "venir", venez: "venir", viennent: "venir"
    };
    const out = [];
    const add = function (value) {
      if (value && !out.includes(value)) {
        out.push(value);
      }
    };
    if (irregular[tokenLower]) {
      add(irregular[tokenLower]);
    }
    addSuffixGuess(tokenLower, /(ées|és|ée|é)$/u, "er", add);
    addSuffixGuess(tokenLower, /(issons|issez|issent)$/u, "ir", add);
    addSuffixGuess(tokenLower, /(ons|ez|ent)$/u, "er", add);
    addSuffixGuess(tokenLower, /(ons|ez|ent)$/u, "re", add);
    addSuffixGuess(tokenLower, /(e|es|is|it)$/u, "er", add);
    addSuffixGuess(tokenLower, /(e|es|is|it)$/u, "ir", add);
    addSuffixGuess(tokenLower, /(e|es|is|it)$/u, "re", add);
    return out;
  }

  function addSuffixGuess(token, pattern, ending, add) {
    if (!pattern.test(token)) {
      return;
    }
    add(token.replace(pattern, "") + ending);
  }

  function fetchSuggestions() {
    const query = els.input.value.trim();
    if (!query || !words.length) {
      hideList();
      return;
    }
    renderSuggestions(findSuggestions(query));
  }

  function findSuggestions(query) {
    const seen = new Set();
    const items = [];
    if (isJapaneseInput(query)) {
      words
        .filter(function (row) { return row.meaning.startsWith(query); })
        .sort(function (a, b) {
          if (a.meaning < b.meaning) {
            return -1;
          }
          if (a.meaning > b.meaning) {
            return 1;
          }
          return compareWord(a, b);
        })
        .some(function (row) {
          if (!seen.has(row.meaning)) {
            seen.add(row.meaning);
            items.push(row.meaning);
          }
          return items.length >= SUGGEST_LIMIT;
        });
    } else {
      const qNorm = normalizeSearchKey(query);
      if (!qNorm) {
        return items;
      }
      words
        .filter(function (row) { return row.word_norm.startsWith(qNorm); })
        .sort(compareWord)
        .some(function (row) {
          if (!seen.has(row.word)) {
            seen.add(row.word);
            items.push(row.word);
          }
          return items.length >= SUGGEST_LIMIT;
        });
    }
    return items;
  }

  function renderSuggestions(items) {
    els.list.replaceChildren();
    currentItems = items.map(function (item) {
      return stringValue(item).trim();
    }).filter(Boolean);
    activeIndex = -1;
    if (!currentItems.length) {
      hideList();
      return;
    }
    currentItems.forEach(function (word, index) {
      const li = document.createElement("li");
      li.className = "suggest-item";
      li.dataset.value = word;
      li.textContent = word;
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectSuggestion(word);
      });
      li.addEventListener("mouseenter", function () {
        activeIndex = index;
        updateActiveSuggestion();
      });
      els.list.appendChild(li);
    });
    els.list.style.display = "block";
  }

  function getActiveSuggestionValue() {
    const node = els.list.querySelector(".suggest-item.active");
    if (node) {
      return stringValue(node.dataset.value || node.textContent).trim();
    }
    if (activeIndex < 0 || activeIndex >= currentItems.length) {
      return "";
    }
    return stringValue(currentItems[activeIndex]).trim();
  }

  function selectSuggestion(value) {
    const q = stringValue(value).trim();
    if (!q) {
      hideList();
      return;
    }
    els.input.value = q;
    hideList();
    navigateToQuery(q);
  }

  function updateActiveSuggestion() {
    els.list.querySelectorAll(".suggest-item").forEach(function (node, index) {
      node.classList.toggle("active", index === activeIndex);
    });
  }

  function hideList() {
    window.clearTimeout(suggestTimer);
    suggestTimer = null;
    els.list.style.display = "none";
    els.list.replaceChildren();
    currentItems = [];
    activeIndex = -1;
  }

  function showEmpty(message) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = message;
    els.results.replaceChildren(div);
  }

  function speakFrench(text, allowRetry) {
    if (!text) {
      return;
    }
    if (!synth) {
      if (!warnedNoSynth) {
        warnedNoSynth = true;
        window.alert("このブラウザでは音声読み上げが利用できません。");
      }
      return;
    }

    const voice = findFrenchVoice();
    if (!voice) {
      const voicesNow = synth.getVoices() || [];
      if (allowRetry && voicesNow.length === 0) {
        window.setTimeout(function () {
          speakFrench(text, false);
        }, 180);
        return;
      }
      if (!warnedNoFrenchVoice) {
        warnedNoFrenchVoice = true;
        window.alert("フランス語音声が見つかりません。ブラウザまたはOSの音声設定を確認してください。");
      }
      return;
    }

    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = getRate();
    utter.voice = voice;
    utter.lang = voice.lang || "fr-FR";
    synth.speak(utter);
  }

  function getRate() {
    const v = parseFloat(els.rateSelect && els.rateSelect.value ? els.rateSelect.value : "0.7");
    return Number.isFinite(v) ? v : 0.7;
  }

  function findFrenchVoice() {
    if (!synth) {
      return null;
    }
    const voices = synth.getVoices() || [];
    for (let i = 0; i < voices.length; i += 1) {
      const lang = (voices[i].lang || "").toLowerCase();
      if (lang.startsWith("fr")) {
        return voices[i];
      }
    }
    return null;
  }

  function isJapaneseInput(value) {
    return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
  }

  function isVerbCategory(category) {
    if (!category) {
      return false;
    }
    if (category.includes("動詞")) {
      return true;
    }
    const lower = toLower(category);
    return lower.includes("verb") || lower.includes("verbe");
  }

  function normalizeSearchKey(value) {
    const table = {
      "à": "a", "á": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
      "ç": "c",
      "è": "e", "é": "e", "ê": "e", "ë": "e",
      "ì": "i", "í": "i", "î": "i", "ï": "i",
      "ñ": "n",
      "ò": "o", "ó": "o", "ô": "o", "ö": "o", "õ": "o",
      "ù": "u", "ú": "u", "û": "u", "ü": "u",
      "ý": "y", "ÿ": "y",
      "œ": "oe", "æ": "ae"
    };
    let s = toLower(String(value || "").trim());
    s = s.replace(/[àáâäãåçèéêëìíîïñòóôöõùúûüýÿœæ]/g, function (ch) {
      return table[ch] || ch;
    });
    s = s.replace(/[ \t\n\r\-’'.]/g, "");
    return s.replace(/[^a-z0-9]/g, "");
  }

  function toLower(value) {
    return String(value || "").toLocaleLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }
})();
