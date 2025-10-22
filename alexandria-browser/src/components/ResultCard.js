import { checkUrlStatus } from '../utils/fetchStatus.js';
import { NSFW_MODES } from '../utils/nsfwFilter.js';

function formatMediaType(type) {
  if (!type) {
    return 'Unknown';
  }
  const normalized = String(type).trim();
  if (!normalized) {
    return 'Unknown';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function createResultCard(result, { nsfwMode }) {
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
  const mediaLabel = formatMediaType(result.mediatype);
  const downloadCount =
    typeof result.downloads === 'number' && Number.isFinite(result.downloads) ? result.downloads : 0;
  meta.textContent = `Type: ${mediaLabel} · Downloads: ${downloadCount}`;

  const severity = typeof result.nsfwLevel === 'string'
    ? result.nsfwLevel
    : typeof result.nsfw_level === 'string'
    ? result.nsfw_level
    : null;
  const isNSFW = result.nsfw === true || severity === 'explicit' || severity === 'mild';
  const mode = typeof nsfwMode === 'string' ? nsfwMode : NSFW_MODES.SAFE;

  if (isNSFW) {
    card.classList.add('result-card-nsfw');
    const labelSpan = document.createElement('span');
    labelSpan.className = 'nsfw-label';
    labelSpan.textContent = severity === 'explicit' ? '(Explicit NSFW)' : '(Sensitive content)';
    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(labelSpan);
    card.dataset.nsfwLabel = severity === 'explicit' ? 'EXPLICIT' : 'SENSITIVE';
    card.dataset.nsfwSeverity = severity || 'mild';
  } else {
    delete card.dataset.nsfwLabel;
    delete card.dataset.nsfwSeverity;
  }

  content.appendChild(title);
  content.appendChild(description);
  content.appendChild(linksWrapper);
  content.appendChild(meta);
  card.appendChild(content);

  const shouldBlur = mode === NSFW_MODES.SAFE && isNSFW;
  if (shouldBlur) {
    card.classList.add('nsfw-hidden');
    const overlay = document.createElement('div');
    overlay.className = 'nsfw-overlay';
    overlay.textContent = 'NSFW content hidden in safe mode';
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
