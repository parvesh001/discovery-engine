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
        <label htmlFor="search-query" className="mb-1 block font-heading text-sm font-medium text-signal">
          Search rental listings
        </label>
        <input
          id="search-query"
          name="query"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. pet friendly cabin with mountain view"
          className="w-full rounded-md border border-hairline bg-panel px-3 py-2 text-sm text-signal placeholder:text-mist focus:outline-none focus:ring-2 focus:ring-flare"
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-flare px-4 py-2 font-heading text-sm font-semibold text-graphite hover:bg-flare/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare focus-visible:ring-offset-2 focus-visible:ring-offset-graphite disabled:cursor-not-allowed disabled:opacity-50"
      >
        Search
      </button>
    </form>
  );
}
