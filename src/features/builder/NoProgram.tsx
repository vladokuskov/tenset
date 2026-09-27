import { useNavigate } from '@tanstack/react-router'
import { useProgramStore } from '../../store/program.store'
import { BodyMini } from '../bodymap'
import { Button, EmptyState, LinkButton, Page, PageBody, PageHeader } from '../../ui'

/** Shown when every program was deleted (the store's Undo toast can still bring one back). */
export function NoProgram() {
  const createBlank = useProgramStore((s) => s.createBlank)
  const navigate = useNavigate()
  return (
    <Page>
      <PageHeader title="Plan" />
      <PageBody>
        <div className="rounded-xl bg-surface">
          <EmptyState
            art={<BodyMini view="both" height={120} className="mb-4" />}
            title="No program yet"
            actions={
              <>
                <LinkButton to="/welcome" variant="primary">
                  Use a template
                </LinkButton>
                <Button
                  onClick={() => {
                    createBlank()
                    void navigate({ to: '/' })
                  }}
                >
                  Start blank
                </Button>
              </>
            }
          >
            Start from a split template or seven empty days.
          </EmptyState>
        </div>
      </PageBody>
    </Page>
  )
}
