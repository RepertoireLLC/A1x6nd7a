import { toggleKeyword } from '../utils/nsfwFilter.js';

export function createSettingsModal({
  initialNSFWMode,
  initialPageSize,
  pageSizeOptions = [],
  keywords,
  onChangeNSFWMode,
  onKeywordsChange,
  onChangePageSize,
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

  const modeOptions = [
    { value: 'safe', label: 'Safe — Truthful content for all ages' },
    { value: 'moderate', label: 'Moderate — Truthful content with mature context' },
    { value: 'off', label: 'No Restriction — All truthful content visible' },
    { value: 'only', label: 'NSFW Only — Explicit truth-focused material only' }
  ];

  modeOptions.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    nsfwModeSelect.appendChild(opt);
  });

  nsfwModeSelect.value = modeOptions.some((option) => option.value === initialNSFWMode)
    ? initialNSFWMode
    : 'safe';

  nsfwModeSelect.addEventListener('change', () => {
    onChangeNSFWMode?.(nsfwModeSelect.value);
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
    if (modeOptions.some((option) => option.value === mode)) {
      nsfwModeSelect.value = mode;
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

  return { overlay, open, close, renderKeywords, setNSFWMode, setPageSize };
}
