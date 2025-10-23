export function createPaginationControls({
  currentPage,
  pageSize,
  totalResults,
  onPageChange,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  loadedCount = 0,
  loadMoreError = null
}) {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 1;
  const totalPages = Math.max(1, Math.ceil(totalResults / safePageSize));
  const container = document.createElement('nav');
  container.className = 'pagination';
  container.setAttribute('aria-label', 'Search results pagination');

  if (typeof onLoadMore === 'function') {
    const info = document.createElement('span');
    info.className = 'pagination-info';
    if (totalResults > 0) {
      const loaded = Math.min(Math.max(loadedCount, 0), totalResults);
      info.textContent = `${loaded.toLocaleString()} of ${totalResults.toLocaleString()} results loaded`;
    } else {
      info.textContent = `${Math.max(loadedCount, 0).toLocaleString()} results loaded`;
    }
    container.appendChild(info);

    if (loadMoreError) {
      const error = document.createElement('div');
      error.className = 'pagination-error';
      error.textContent = loadMoreError;
      container.appendChild(error);
    }

    if (hasMore) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pagination-button load-more-button';
      if (loadingMore) {
        button.disabled = true;
        button.classList.add('loading');
        button.textContent = 'Loading…';
      } else {
        button.textContent = 'Load more results';
      }
      button.addEventListener('click', () => {
        if (!loadingMore) {
          onLoadMore();
        }
      });
      container.appendChild(button);
    } else if (!loadMoreError && totalResults > 0) {
      const end = document.createElement('span');
      end.className = 'pagination-end';
      end.textContent = 'End of results';
      container.appendChild(end);
    }

    return container;
  }

  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `Page ${currentPage} of ${totalPages}`;

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.textContent = 'Previous';
  prevButton.className = 'pagination-button';
  prevButton.disabled = currentPage <= 1;

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = 'Next';
  nextButton.className = 'pagination-button';
  nextButton.disabled = currentPage >= totalPages;

  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      onPageChange?.(currentPage - 1);
    }
  });

  nextButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
      onPageChange?.(currentPage + 1);
    }
  });

  container.appendChild(prevButton);
  container.appendChild(info);
  container.appendChild(nextButton);

  return container;
}
