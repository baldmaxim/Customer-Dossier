// «Контекст объекта» у участия компании — окном: её роли на объекте и события объекта с пересечением
// периодов. Раньше — раскрытием под строкой рядом с «Откуда известно»: два раскрытия на строку
// вкладывались друг в друга. Контекст грузится только в открытом окне; переход к объекту — из окна.

import { FC, useState } from 'react';

import { ProjectContextPanel } from '../ProjectContextPanel';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Dialog } from '../ui/Dialog';

interface IProjectContextButtonProps {
  companyId: number;
  projectId: number;
  projectName: string;
}

export const ProjectContextButton: FC<IProjectContextButtonProps> = ({ companyId, projectId, projectName }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="link" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Контекст объекта
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Объект «${projectName}»`}
        size="lg"
        footer={
          <ButtonLink to={`/projects/${projectId}`} iconEnd="forward">
            Карточка объекта
          </ButtonLink>
        }
      >
        <ProjectContextPanel companyId={companyId} projectId={projectId} />
      </Dialog>
    </>
  );
};
