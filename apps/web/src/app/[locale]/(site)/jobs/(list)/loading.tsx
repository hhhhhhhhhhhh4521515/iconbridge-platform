/**
 * Shown while a search is loading: the shape of the page, without content.
 * It lives in the "(list)" group so it covers the list only: the job page has no
 * loading state, and can therefore answer a real 404 status for a closed job.
 */
export default function JobsLoading() {
  return (
    <div className="container-page py-10" aria-busy="true">
      <div className="skeleton mb-2 h-9 w-56" />
      <div className="skeleton mb-8 h-5 w-80 max-w-full" />
      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <div className="skeleton h-96" />
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="rounded-2xl border border-border p-5">
              <div className="skeleton h-6 w-32" />
              <div className="skeleton mt-4 h-6 w-full" />
              <div className="skeleton mt-2 h-5 w-40" />
              <div className="skeleton mt-8 h-5 w-48" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
