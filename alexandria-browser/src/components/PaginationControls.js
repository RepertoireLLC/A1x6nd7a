export function createPaginationControls({
  currentPage,
  pageSize,
  totalResults,
  onPageChange
}) {
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const container = document.createElement('nav');
  container.className = 'pagination';
  container.setAttribute('aria-label', 'Search results pagination');

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
