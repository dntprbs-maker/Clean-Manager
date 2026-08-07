export default function SiteFilterChips({ sites, value, onChange }) {
  if (sites.length <= 1) return null;
  const options = ['all', ...sites];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-4 px-4">
      {options.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap ${
              active ? 'bg-[#2563EB] text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}
          >
            {s === 'all' ? '전체' : s}
          </button>
        );
      })}
    </div>
  );
}
