import { toggleKeyword } from '../utils/nsfwFilter.js';

export function createSettingsModal({
  initialNSFWEnabled,
  keywords,
  onToggleNSFW,
  onKeywordsChange,
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

  const nsfwToggleWrapper = document.createElement('label');
  nsfwToggleWrapper.className = 'toggle-wrapper';
  nsfwToggleWrapper.textContent = 'Enable NSFW filtering';

  const nsfwToggle = document.createElement('input');
  nsfwToggle.type = 'checkbox';
  nsfwToggle.checked = initialNSFWEnabled;
  nsfwToggle.addEventListener('change', () => {
    onToggleNSFW?.(nsfwToggle.checked);
  });

  nsfwToggleWrapper.appendChild(nsfwToggle);
  content.appendChild(nsfwToggleWrapper);

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

  return { overlay, open, close, renderKeywords };
}
