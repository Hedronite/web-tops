export interface Note {
  readonly id: number;
  readonly text: string;
}

export interface NoteStore {
  add(text: string): Note;
  get(id: number): Note | undefined;
  list(): readonly Note[];
}

/** An in-memory store of notes; ids are 1, 2, 3 in the order the notes were added. */
export function createStore(): NoteStore {
  const notes: Note[] = [];
  return {
    add(text) {
      const note = { id: notes.length + 1, text };
      notes.push(note);
      return note;
    },
    get: (id) => notes.find((note) => note.id === id),
    list: () => [...notes],
  };
}
