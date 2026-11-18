type Props = { items: string[]; on?: boolean };
export function List({ items, on }: Props) {
  return (
    <ul>
      {items.map((item) => (item ? <li key={item}>{item}</li> : null))}
      {on && <li onClick={() => { if (on) console.log(1); }}>x</li>}
    </ul>
  );
}
export const pair = <T,>(a: T, b: T) => (a ? [a, b] : [b]);
export const frag = <><b>{pair(1, 2).length > 1 || false}</b></>;
