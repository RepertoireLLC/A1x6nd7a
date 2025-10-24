import { checkUrlStatus } from '../utils/fetchStatus.js';
import { NSFW_MODES } from '../utils/nsfwFilter.js';

function formatMediaType(type) {
  if (!type) {
    return 'Archive item';
  }
  const normalized = String(type).trim().toLowerCase();
  switch (normalized) {
    case 'texts':
      return 'Text';
    case 'audio':
    case 'etree':
      return 'Audio';
    case 'movies':
    case 'video':
      return 'Video';
    case 'software':
      return 'Software';
    case 'image':
    case 'images':
      return 'Image';
    case 'data':
      return 'Data';
    case 'web':
      return 'Web page';
    case 'collection':
      return 'Collection';
    default:
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}

function mediaEmoji(type) {
  if (!type) return '🗂️';
  const normalized = String(type).trim().toLowerCase();
  switch (normalized) {
    case 'texts':
      return '📚';
    case 'audio':
    case 'etree':
      return '🎧';
    case 'movies':
    case 'video':
      return '🎬';
    case 'software':
      return '💾';
    case 'image':
    case 'images':
      return '🖼️';
    case 'data':
      return '📊';
    case 'web':
      return '🌐';
    default:
      return '🗂️';
  }
}

function formatYear(result) {
  if (typeof result.year === 'string' && result.year.trim()) {
    return result.year.trim();
  }
  if (typeof result.date === 'string' && result.date.trim()) {
    return result.date.trim();
  }
  if (typeof result.publicdate === 'string' && result.publicdate.trim()) {
    return result.publicdate.split('T')[0];
  }
  return null;
}

function createMetaSegments(result, mediaLabel, scorePercent, trustLabel) {
  const segments = [];
  const year = formatYear(result);
  if (year) {
    segments.push(year);
  }
  if (mediaLabel) {
    segments.push(mediaLabel);
  }
  const downloads =
    typeof result.downloads === 'number' && Number.isFinite(result.downloads) ? result.downloads : null;
  if (downloads && downloads > 0) {
    segments.push(`${downloads.toLocaleString()} downloads`);
  }
  const language = Array.isArray(result.language)
    ? result.language.find((entry) => typeof entry === 'string' && entry.trim())
    : typeof result.language === 'string'
    ? result.language.trim()
    : null;
  if (language) {
    segments.push(language);
  }
  if (scorePercent !== null) {
    segments.push(`Truth relevance ${scorePercent}%`);
  }
  if (trustLabel) {
    segments.push(`${trustLabel.charAt(0).toUpperCase() + trustLabel.slice(1)} trust`);
  }
  return segments;
}

function createBadge(label, variant) {
  const badge = document.createElement('span');
  badge.className = `result-badge result-badge-${variant}`;
  badge.textContent = label;
  return badge;
}

function createAvailabilityLabel(availability) {
  if (!availability) {
    return null;
  }
  switch (availability) {
    case 'online':
      return 'Original online';
    case 'archived-only':
      return 'Archive only';
    case 'offline':
      return 'Offline';
    default:
      return null;
  }
}

function resolveThumbnail(result) {
  if (result.thumbnail && typeof result.thumbnail === 'string' && result.thumbnail.trim()) {
    return result.thumbnail.trim();
  }
  if (typeof result.identifier === 'string' && result.identifier.trim()) {
    return `https://archive.org/services/img/${encodeURIComponent(result.identifier.trim())}`;
  }
  return null;
}

export function createResultCard(result, { nsfwMode }) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const content = document.createElement('div');
  content.className = 'result-content';

  const layout = document.createElement('div');
  layout.className = 'result-layout';

  const thumbWrapper = document.createElement('div');
  thumbWrapper.className = 'result-thumb-wrapper';
  const thumbnailUrl = resolveThumbnail(result);
  if (thumbnailUrl) {
    const thumbImage = document.createElement('img');
    thumbImage.src = thumbnailUrl;
    thumbImage.alt = '';
    thumbImage.loading = 'lazy';
    thumbImage.className = 'result-thumbnail';
    thumbWrapper.appendChild(thumbImage);
  } else {
    const icon = document.createElement('span');
    icon.className = 'result-thumb-fallback';
    icon.textContent = mediaEmoji(result.mediatype);
    thumbWrapper.appendChild(icon);
  }

  const body = document.createElement('div');
  body.className = 'result-body';

  const archiveUrl =
    (typeof result.archiveUrl === 'string' && result.archiveUrl) ||
    (typeof result.identifier === 'string'
      ? `https://archive.org/details/${encodeURIComponent(result.identifier)}`
      : '#');

  const title = document.createElement('h3');
  title.className = 'result-title';
  const titleLink = document.createElement('a');
  titleLink.href = archiveUrl;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = result.title || result.identifier;
  title.appendChild(titleLink);

  const badges = document.createElement('div');
  badges.className = 'result-badges';
  const mediaLabel = formatMediaType(result.mediatype);
  if (mediaLabel) {
    badges.appendChild(createBadge(mediaLabel, 'type'));
  }

  const availabilityLabel = createAvailabilityLabel(result.availability);
  if (availabilityLabel) {
    badges.appendChild(createBadge(availabilityLabel, `availability`));
  }

  const trustLabel = (result.source_trust ?? result.source_trust_level ?? '').toString();

  const scoreValue =
    typeof result.score === 'number' && Number.isFinite(result.score)
      ? result.score
      : typeof result.score === 'string'
      ? Number.parseFloat(result.score)
      : null;
  const scorePercent = scoreValue !== null && Number.isFinite(scoreValue) ? Math.round(scoreValue * 100) : null;

  if (scorePercent !== null) {
    badges.appendChild(createBadge(`Truth ${scorePercent}%`, 'score'));
  }

  if (trustLabel) {
    badges.appendChild(createBadge(`${trustLabel.charAt(0).toUpperCase() + trustLabel.slice(1)} trust`, 'trust'));
  }

  const statusChip = document.createElement('span');
  statusChip.className = 'status-chip status-chip-checking';
  statusChip.textContent = 'Checking status…';
  badges.appendChild(statusChip);

  const header = document.createElement('div');
  header.className = 'result-header';
  header.appendChild(title);
  header.appendChild(badges);

  const description = document.createElement('p');
  description.className = 'result-description';
  description.textContent = result.description;

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  const metaSegments = createMetaSegments(result, mediaLabel, scorePercent, trustLabel);
  meta.textContent = metaSegments.length > 0 ? metaSegments.join(' · ') : 'No additional metadata available.';

  const linksWrapper = document.createElement('div');
  linksWrapper.className = 'result-links';

  const reportButton = document.createElement('button');
  reportButton.type = 'button';
  reportButton.className = 'report-button';
  reportButton.textContent = 'Report issue';
  reportButton.addEventListener('click', () => {
    const event = new CustomEvent('alexandria:report', {
      detail: {
        identifier: result.identifier,
        title: result.title || result.identifier,
        archiveUrl: result.archiveUrl
      }
    });
    card.dispatchEvent(event);
  });

  linksWrapper.appendChild(reportButton);

  if (result.originalUrl) {
    const originalAnchor = document.createElement('a');
    originalAnchor.href = result.originalUrl;
    originalAnchor.target = '_blank';
    originalAnchor.rel = 'noopener noreferrer';
    originalAnchor.textContent = 'Original source';
    linksWrapper.appendChild(originalAnchor);
  }

  if (archiveUrl && archiveUrl !== '#') {
    const archiveAnchor = document.createElement('a');
    archiveAnchor.href = archiveUrl;
    archiveAnchor.target = '_blank';
    archiveAnchor.rel = 'noopener noreferrer';
    archiveAnchor.textContent = 'View on archive.org';
    linksWrapper.appendChild(archiveAnchor);

    const waybackAnchor = document.createElement('a');
    waybackAnchor.href = `https://web.archive.org/web/*/${encodeURIComponent(archiveUrl)}`;
    waybackAnchor.target = '_blank';
    waybackAnchor.rel = 'noopener noreferrer';
    waybackAnchor.textContent = 'Wayback snapshots';
    linksWrapper.appendChild(waybackAnchor);
  }

  body.appendChild(header);
  if (result.description) {
    body.appendChild(description);
  }
  body.appendChild(meta);
  body.appendChild(linksWrapper);

  layout.appendChild(thumbWrapper);
  layout.appendChild(body);
  content.appendChild(layout);
  card.appendChild(content);

  const severity = typeof result.nsfwLevel === 'string'
    ? result.nsfwLevel
    : typeof result.nsfw_level === 'string'
    ? result.nsfw_level
    : null;
  const isNSFW = result.nsfw === true || severity === 'explicit' || severity === 'mild';
  const mode = typeof nsfwMode === 'string' ? nsfwMode : NSFW_MODES.SAFE;

  if (isNSFW) {
    card.classList.add('result-card-nsfw');
    card.dataset.nsfwLabel = severity === 'explicit' ? 'EXPLICIT' : 'SENSITIVE';
    card.dataset.nsfwSeverity = severity || 'mild';
  } else {
    delete card.dataset.nsfwLabel;
    delete card.dataset.nsfwSeverity;
  }

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
    statusChip.classList.remove('status-chip-online', 'status-chip-offline', 'status-chip-unknown', 'status-chip-checking');
    switch (state) {
      case 'online':
        statusChip.classList.add('status-chip-online');
        statusChip.textContent = 'Online';
        break;
      case 'offline':
        statusChip.classList.add('status-chip-offline');
        statusChip.textContent = 'Offline';
        break;
      default:
        statusChip.classList.add('status-chip-unknown');
        statusChip.textContent = 'Status unknown';
        break;
    }
  });

  return card;
}
