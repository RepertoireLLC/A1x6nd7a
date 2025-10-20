export function createSearchBar({ onSubmit, onOpenSettings }) {
  const form = document.createElement('form');
  form.className = 'search-form';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search the Internet Archive…';
  input.autocomplete = 'off';
  input.required = true;
  input.className = 'search-input';

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'search-button';
  button.textContent = 'Search';

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'settings-button';
  settingsButton.setAttribute('aria-label', 'Open settings');
  settingsButton.textContent = '⚙️';

  form.appendChild(input);
  form.appendChild(button);
  form.appendChild(settingsButton);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    onSubmit?.(query);
  });

  settingsButton.addEventListener('click', () => {
    onOpenSettings?.();
  });

  return { form, input };
}
