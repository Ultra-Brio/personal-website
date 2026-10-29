/** What openCard may read of an album item besides its title: the fields of AlbumCard / Postcard that name it */
export type BookLabelItem = { label?: string; nameLocal?: string; placeLocal?: string };

/** Every string the React shell shows or reads out. Pass a partial object as `labels` to translate or reword; functions get the dynamic part. */
export type BookLabels = {
  /** aria-label of the whole book region */
  region: string;
  prev: string;
  next: string;
  openBook: string;
  closeBook: string;
  loading: string;
  /** aria-label of the hidden list of cards on the visible pages */
  cardsHere: string;
  /** read out for the page counter, e.g. "Spread 2 of 8" */
  pageOf: (current: number, total: number) => string;
  /**
   * accessible name of a card (link / button). title: the item's label (else its id); item: the album item itself (an AlbumCard, a
   * Postcard …) for a name in its own script, e.g. 细看「月白」 from nameLocal / placeLocal
   */
  openCard: (title: string, item?: BookLabelItem) => string;
};

export const DEFAULT_LABELS: BookLabels = {
  region: "Album",
  prev: "Previous page",
  next: "Next page",
  openBook: "Open the album",
  closeBook: "Close the album",
  loading: "Opening the album…",
  cardsHere: "Cards on these pages",
  pageOf: (current, total) => `Page ${current} of ${total}`,
  openCard: (title) => `Open ${title}`,
};
