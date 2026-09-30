import { FC } from 'react';

import type { IGraphResponse } from './graphModel';
import { graphNotes } from './graphText';
import styles from './Graph.module.css';

interface IGraphNotesProps {
  graph: IGraphResponse;
  /** Что делает нажатие на узел в этом месте портала — первой строкой. */
  hint?: string;
}

/** Как читать схему — один раз, под ней: раньше те же оговорки стояли и над схемой, и в легенде, и в плашке. */
export const GraphNotes: FC<IGraphNotesProps> = ({ graph, hint }) => (
  <div className={styles.notes}>
    <p className={styles.notesTitle}>Как читать схему</p>
    <ul className={styles.notesList}>
      {[...(hint ? [hint] : []), ...graphNotes(graph)].map(note => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  </div>
);
