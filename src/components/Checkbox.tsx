export default function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label class="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={e => props.onChange(e.currentTarget.checked)}
        class={`
          h-5 w-5 appearance-none rounded-sm border-2 transition
          border-primary bg-primary-light-3/40
          checked:bg-primary checked:border-primary
          checked:[&::after]:content-['✔'] checked:[&::after]:text-white
          checked:[&::after]:text-xs checked:[&::after]:font-bold
          checked:[&::after]:flex checked:[&::after]:items-center checked:[&::after]:justify-center
        `}
      />
      {props.label && (
        <span class="text-sm text-text-dark-1 font-medium">{props.label}</span>
      )}
    </label>
  );
}
