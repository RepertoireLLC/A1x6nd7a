import { toggleKeyword } from '../utils/nsfwFilter.js';

export function createSettingsModal({
  initialNSFWMode,
  initialPageSize,
  pageSizeOptions = [],
  keywords,
  initialAISearchEnabled = false,
  onChangeNSFWMode,
  onKeywordsChange,
  onChangePageSize,
  onToggleAISearch,
  onResetSettings,
  onClose
}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';

  const dialog = document.createElement('div');
  dialog.className = 'modal';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  header.appendChild(title);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '✖';
  closeButton.className = 'modal-close';
  closeButton.addEventListener('click', () => close());

  header.appendChild(closeButton);
  dialog.appendChild(header);

  const content = document.createElement('div');
  content.className = 'modal-content';

  const nsfwModeWrapper = document.createElement('label');
  nsfwModeWrapper.className = 'settings-label';
  nsfwModeWrapper.textContent = 'NSFW filtering mode';

  const nsfwModeSelect = document.createElement('select');
  nsfwModeSelect.className = 'settings-select';

  // Map legacy storage values onto the expanded toggle set so the select stays consistent.
  const normalizeModeValue = (mode) => {
    if (typeof mode !== 'string') {
      return 'safe';
    }
    const lowered = mode.toLowerCase();
    if (lowered === 'moderate') return 'moderate';
    if (['unrestricted', 'off', 'none', 'no_filter'].includes(lowered)) {
      return 'unrestricted';
    }
    if (['nsfw-only', 'only', 'only_nsfw', 'nsfw'].includes(lowered)) {
      return 'nsfw-only';
    }
    return 'safe';
  };

  const modeOptions = [
    { value: 'safe', label: 'Safe — Truthful content for all ages' },
    { value: 'moderate', label: 'Moderate — Truthful content with mature context' },
    { value: 'unrestricted', label: 'No Restriction — All truthful content visible' },
    { value: 'nsfw-only', label: 'NSFW Only — Explicit truth-focused material only' }
  ];

  modeOptions.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    nsfwModeSelect.appendChild(opt);
  });

  const resolvedInitialMode = normalizeModeValue(initialNSFWMode);
  nsfwModeSelect.value = modeOptions.some((option) => option.value === resolvedInitialMode)
    ? resolvedInitialMode
    : 'safe';

  nsfwModeSelect.addEventListener('change', () => {
    const nextMode = normalizeModeValue(nsfwModeSelect.value);
    nsfwModeSelect.value = nextMode;
    onChangeNSFWMode?.(nextMode);
  });

  nsfwModeWrapper.appendChild(nsfwModeSelect);
  content.appendChild(nsfwModeWrapper);

  const preferencesSection = document.createElement('div');
  preferencesSection.className = 'settings-section';

  const pageSizeLabel = document.createElement('label');
  pageSizeLabel.className = 'settings-label';
  pageSizeLabel.textContent = 'Results per page';

  const pageSizeSelect = document.createElement('select');
  pageSizeSelect.className = 'settings-select';
  const normalizedOptions = pageSizeOptions.length ? pageSizeOptions : [10, 20, 50];
  const numericOptions = [];
  normalizedOptions.forEach((option) => {
    const value = Number(option);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = `${value} results`;
    pageSizeSelect.appendChild(opt);
    numericOptions.push(value);
  });
  const initialSize = numericOptions.find((value) => value === Number(initialPageSize)) ?? numericOptions[0] ?? 10;
  pageSizeSelect.value = String(initialSize);

  pageSizeSelect.addEventListener('change', () => {
    onChangePageSize?.(Number(pageSizeSelect.value));
  });

  pageSizeLabel.appendChild(pageSizeSelect);
  preferencesSection.appendChild(pageSizeLabel);

  const aiToggleWrapper = document.createElement('label');
  aiToggleWrapper.className = 'toggle-wrapper';

  const aiToggleText = document.createElement('span');
  aiToggleText.textContent = 'AI-assisted search (interprets queries before searching)';

  const aiToggle = document.createElement('input');
  aiToggle.type = 'checkbox';
  aiToggle.checked = Boolean(initialAISearchEnabled);
  aiToggle.setAttribute('aria-label', 'Enable AI-assisted search');

  aiToggle.addEventListener('change', () => {
    onToggleAISearch?.(aiToggle.checked);
  });

  aiToggleWrapper.appendChild(aiToggleText);
  aiToggleWrapper.appendChild(aiToggle);
  preferencesSection.appendChild(aiToggleWrapper);
  content.appendChild(preferencesSection);

  const keywordSection = document.createElement('div');
  keywordSection.className = 'keyword-section';

  const keywordTitle = document.createElement('h3');
  keywordTitle.textContent = 'NSFW Keywords';
  keywordSection.appendChild(keywordTitle);

  const keywordList = document.createElement('ul');
  keywordList.className = 'keyword-list';

  const renderKeywords = (items) => {
    keywordList.innerHTML = '';
    items.forEach((word) => {
      const item = document.createElement('li');
      item.textContent = word;
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', async () => {
        const updated = await toggleKeyword(word, 'remove');
        renderKeywords(updated);
        onKeywordsChange?.(updated);
      });
      item.appendChild(removeButton);
      keywordList.appendChild(item);
    });
  };

  renderKeywords(keywords);

  keywordSection.appendChild(keywordList);

  const addForm = document.createElement('form');
  addForm.className = 'keyword-form';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'Add keyword…';
  const addButton = document.createElement('button');
  addButton.type = 'submit';
  addButton.textContent = 'Add';

  addForm.appendChild(addInput);
  addForm.appendChild(addButton);
  keywordSection.appendChild(addForm);

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = addInput.value.trim();
    if (!value) return;
    const updated = await toggleKeyword(value, 'add');
    renderKeywords(updated);
    addInput.value = '';
    onKeywordsChange?.(updated);
  });

  content.appendChild(keywordSection);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'danger-button';
  resetButton.textContent = 'Reset preferences';
  resetButton.addEventListener('click', () => {
    onResetSettings?.();
  });

  actions.appendChild(resetButton);
  content.appendChild(actions);
  dialog.appendChild(content);
  overlay.appendChild(dialog);

  function open() {
    overlay.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
    onClose?.();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  function setNSFWMode(mode) {
    const normalized = normalizeModeValue(mode);
    if (modeOptions.some((option) => option.value === normalized)) {
      nsfwModeSelect.value = normalized;
    } else {
      nsfwModeSelect.value = 'safe';
    }
  }

  function setPageSize(size) {
    const desired = numericOptions.find((value) => value === Number(size));
    if (desired) {
      pageSizeSelect.value = String(desired);
    } else if (numericOptions.length > 0) {
      pageSizeSelect.value = String(numericOptions[0]);
    }
  }

  function setAISearchEnabled(enabled) {
    aiToggle.checked = Boolean(enabled);
  }

  return { overlay, open, close, renderKeywords, setNSFWMode, setPageSize, setAISearchEnabled };
}
