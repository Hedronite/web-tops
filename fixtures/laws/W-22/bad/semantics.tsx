export const picture = <img src="a.png" />; // expect: alt-text
export const clicker = <div onClick={() => undefined}>go</div>; // expect: click-events-have-key-events, no-static-element-interactions
export const caption = <label>Name</label>; // expect: label-has-associated-control
export const link = <a href="#">go</a>; // expect: anchor-is-valid
