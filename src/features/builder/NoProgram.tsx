import { useNavigate } from '@tanstack/react-router'
import { useProgramStore } from '../../store/program.store'
import { BodyMini } from '../bodymap'
import { useMessages } from '../../i18n/messages'
import { Button, EmptyState, LinkButton, Page, PageBody, PageHeader } from '../../ui'
import { builderMessages } from './messages'

/** Shown when every program was deleted (the store's Undo toast can still bring one back). */
export function NoProgram() {
  const createBlank = useProgramStore((s) => s.createBlank)
  const navigate = useNavigate()
  const m = useMessages(builderMessages)
  return (
    <Page>
      <PageHeader title={m.plan} />
      <PageBody>
        <div className="rounded-xl bg-surface">
          <EmptyState
            art={<BodyMini view="both" height={120} className="mb-4" />}
            title={m.noProgram}
            actions={
              <>
                <LinkButton to="/welcome" variant="primary">
                  {m.useTemplate}
                </LinkButton>
                <Button
                  onClick={() => {
                    createBlank()
                    void navigate({ to: '/' })
                  }}
                >
                  {m.startBlank}
                </Button>
              </>
            }
          >
            {m.noProgramBody}
          </EmptyState>
        </div>
      </PageBody>
    </Page>
  )
}
