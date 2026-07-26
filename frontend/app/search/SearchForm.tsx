'use client';

type SearchFormProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

export function SearchForm({ value, onChange, onSubmit, disabled }: SearchFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <label htmlFor="search-query" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
          Search rental listings
        </label>
        <input
          id="search-query"
          name="query"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. pet friendly cabin with mountain view"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-50"
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Search
      </button>
    </form>
  );
}
