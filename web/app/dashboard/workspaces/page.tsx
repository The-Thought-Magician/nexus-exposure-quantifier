'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  owner_id?: string
  legal_name?: string
  fiscal_year_end?: string
  created_at?: string
}

interface Member {
  id: string
  workspace_id: string
  user_id: string
  role?: string
  created_at?: string
}

const roleTone = (role?: string) => {
  switch ((role || '').toLowerCase()) {
    case 'owner':
      return 'violet' as const
    case 'admin':
      return 'blue' as const
    default:
      return 'slate' as const
  }
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // create / edit modal
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Workspace | null>(null)
  const [form, setForm] = useState({ name: '', legal_name: '', fiscal_year_end: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [deleting, setDeleting] = useState(false)

  // members panel
  const [membersFor, setMembersFor] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [newMember, setNewMember] = useState({ user_id: '', role: 'member' })
  const [addingMember, setAddingMember] = useState(false)

  const load = () => {
    setLoading(true)
    api
      .listWorkspaces()
      .then((data) => setWorkspaces(Array.isArray(data) ? data : data?.workspaces || []))
      .catch((e) => setError(e?.message || 'Failed to load workspaces.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter(
      (w) => w.name?.toLowerCase().includes(q) || w.legal_name?.toLowerCase().includes(q),
    )
  }, [workspaces, search])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', legal_name: '', fiscal_year_end: '' })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (w: Workspace) => {
    setEditing(w)
    setForm({
      name: w.name || '',
      legal_name: w.legal_name || '',
      fiscal_year_end: w.fiscal_year_end || '',
    })
    setFormError('')
    setFormOpen(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Workspace name is required.')
      return
    }
    setSaving(true)
    setFormError('')
    const body = {
      name: form.name.trim(),
      legal_name: form.legal_name.trim() || null,
      fiscal_year_end: form.fiscal_year_end.trim() || null,
    }
    try {
      if (editing) {
        await api.updateWorkspace(editing.id, body)
      } else {
        await api.createWorkspace(body)
      }
      setFormOpen(false)
      load()
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save workspace.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteWorkspace(deleteTarget.id)
      setDeleteTarget(null)
      if (membersFor?.id === deleteTarget.id) setMembersFor(null)
      load()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete workspace.')
    } finally {
      setDeleting(false)
    }
  }

  const openMembers = (w: Workspace) => {
    setMembersFor(w)
    setMembers([])
    setMembersError('')
    setNewMember({ user_id: '', role: 'member' })
    setMembersLoading(true)
    api
      .listMembers(w.id)
      .then((data) => setMembers(Array.isArray(data) ? data : data?.members || []))
      .catch((e) => setMembersError(e?.message || 'Failed to load members.'))
      .finally(() => setMembersLoading(false))
  }

  const reloadMembers = (id: string) => {
    setMembersLoading(true)
    api
      .listMembers(id)
      .then((data) => setMembers(Array.isArray(data) ? data : data?.members || []))
      .catch((e) => setMembersError(e?.message || 'Failed to load members.'))
      .finally(() => setMembersLoading(false))
  }

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!membersFor || !newMember.user_id.trim()) return
    setAddingMember(true)
    setMembersError('')
    try {
      await api.addMember(membersFor.id, {
        user_id: newMember.user_id.trim(),
        role: newMember.role,
      })
      setNewMember({ user_id: '', role: 'member' })
      reloadMembers(membersFor.id)
    } catch (err: any) {
      setMembersError(err?.message || 'Failed to add member.')
    } finally {
      setAddingMember(false)
    }
  }

  const removeMember = async (memberId: string) => {
    if (!membersFor) return
    setMembersError('')
    try {
      await api.removeMember(membersFor.id, memberId)
      reloadMembers(membersFor.id)
    } catch (err: any) {
      setMembersError(err?.message || 'Failed to remove member.')
    }
  }

  if (loading) return <Spinner label="Loading workspaces..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Workspaces</h1>
          <p className="mt-1 text-sm text-stone-500">
            Organize engagements by legal entity and manage who can access them.
          </p>
        </div>
        <Button onClick={openCreate}>New workspace</Button>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workspaces..."
          className="w-full max-w-xs rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-xs text-stone-500">
          {filtered.length} of {workspaces.length}
        </span>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No workspaces yet"
          description="Create a workspace to group engagements for a legal entity or client."
          action={<Button onClick={openCreate}>Create workspace</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="No workspaces match your search." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Workspace</TH>
                  <TH>Legal name</TH>
                  <TH>Fiscal year end</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((w) => (
                  <TR key={w.id}>
                    <TD className="font-medium text-stone-100">{w.name}</TD>
                    <TD className="text-stone-400">{w.legal_name || '—'}</TD>
                    <TD className="text-stone-400">{w.fiscal_year_end || '—'}</TD>
                    <TD className="text-stone-500">
                      {w.created_at ? new Date(w.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openMembers(w)}>
                          Members
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleteTarget(w)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Members panel */}
      {membersFor ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-stone-100">
                Members · {membersFor.name}
              </h2>
              <p className="text-xs text-stone-500">Add members by user ID and assign a role.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setMembersFor(null)}>
              Close
            </Button>
          </CardHeader>
          <CardBody className="space-y-4">
            <form onSubmit={addMember} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-stone-400">User ID</label>
                <input
                  value={newMember.user_id}
                  onChange={(e) => setNewMember((m) => ({ ...m, user_id: e.target.value }))}
                  placeholder="user_..."
                  className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-400">Role</label>
                <select
                  value={newMember.role}
                  onChange={(e) => setNewMember((m) => ({ ...m, role: e.target.value }))}
                  className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <Button type="submit" disabled={addingMember || !newMember.user_id.trim()}>
                {addingMember ? 'Adding...' : 'Add member'}
              </Button>
            </form>

            {membersError ? (
              <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
                {membersError}
              </div>
            ) : null}

            {membersLoading ? (
              <Spinner label="Loading members..." />
            ) : members.length === 0 ? (
              <EmptyState title="No members" description="Only the owner has access. Add teammates above." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>User ID</TH>
                    <TH>Role</TH>
                    <TH>Added</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {members.map((m) => {
                    const isOwner = (m.role || '').toLowerCase() === 'owner'
                    return (
                      <TR key={m.id}>
                        <TD className="font-mono text-xs text-stone-200">{m.user_id}</TD>
                        <TD>
                          <Badge tone={roleTone(m.role)}>{m.role || 'member'}</Badge>
                        </TD>
                        <TD className="text-stone-500">
                          {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                        </TD>
                        <TD>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={isOwner}
                              onClick={() => removeMember(m.id)}
                              title={isOwner ? 'The owner cannot be removed' : 'Remove member'}
                            >
                              Remove
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit workspace' : 'New workspace'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
              {formError}
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              placeholder="Acme Holdings"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Legal name</label>
            <input
              value={form.legal_name}
              onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              placeholder="Acme Holdings, Inc."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Fiscal year end</label>
            <input
              value={form.fiscal_year_end}
              onChange={(e) => setForm((f) => ({ ...f, fiscal_year_end: e.target.value }))}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              placeholder="12-31"
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete workspace"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete workspace'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-300">
          Delete <span className="font-semibold text-stone-100">{deleteTarget?.name}</span>? Engagements and
          members tied to this workspace may be affected. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
