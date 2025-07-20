export default function Dropdown(props: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label?: string }) {
  return (
    <label class="block">
      {props.label && <span class="block text-sm font-semibold text-text-dark-1 mb-1">{props.label}</span>}
      <select
        class="bg-background-light-2 border border-background-light-3 p-2 rounded w-full text-text-dark-1"
        value={props.value}
        onChange={e => props.onChange(e.currentTarget.value)}
      >
        {props.options.map(opt => (
          <option value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}