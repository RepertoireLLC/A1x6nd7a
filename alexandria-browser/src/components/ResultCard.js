import { checkUrlStatus } from '../utils/fetchStatus.js';

export function createResultCard(result, { nsfwFiltering }) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const content = document.createElement('div');
  content.className = 'result-content';

  const title = document.createElement('h3');
  title.className = 'result-title';
  const titleLink = document.createElement('a');
  titleLink.href = result.archiveUrl;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = result.title;
  title.appendChild(titleLink);

  const description = document.createElement('p');
  description.className = 'result-description';
  description.textContent = result.description;

  const linksWrapper = document.createElement('div');
  linksWrapper.className = 'result-links';

  const archiveAnchor = document.createElement('a');
  archiveAnchor.href = result.archiveUrl;
  archiveAnchor.target = '_blank';
  archiveAnchor.rel = 'noopener noreferrer';
  archiveAnchor.textContent = 'View on Archive.org';

  linksWrapper.appendChild(archiveAnchor);

  if (result.originalUrl) {
    const originalAnchor = document.createElement('a');
    originalAnchor.href = result.originalUrl;
    originalAnchor.target = '_blank';
    originalAnchor.rel = 'noopener noreferrer';
    originalAnchor.textContent = 'Original Source';
    linksWrapper.appendChild(originalAnchor);
  }

  const status = document.createElement('span');
  status.className = 'status-indicator unknown';
  status.textContent = 'Checking availability…';

  linksWrapper.appendChild(status);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = `Downloads: ${result.downloads}`;

  content.appendChild(title);
  content.appendChild(description);
  content.appendChild(linksWrapper);
  content.appendChild(meta);
  card.appendChild(content);

  if (nsfwFiltering && result.nsfw) {
    card.classList.add('nsfw-hidden');
    const overlay = document.createElement('div');
    overlay.className = 'nsfw-overlay';
    overlay.textContent = 'NSFW content hidden';
    card.appendChild(overlay);
  }

  const urlToTest = result.originalUrl || result.archiveUrl;
  checkUrlStatus(urlToTest).then((state) => {
    status.classList.remove('unknown', 'online', 'offline');
    status.classList.add(state);
    if (state === 'online') {
      status.textContent = 'Available online';
    } else if (state === 'offline') {
      status.textContent = 'Currently offline';
    } else {
      status.textContent = 'Status unknown';
    }
  });

  return card;
}
