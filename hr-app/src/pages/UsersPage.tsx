import { type FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, UserPlus, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type {
  InviteCreate,
  InviteListItem,
  InviteResponse,
  User,
  UserCreate,
  TenantMemberRole,
  UserUpdate,
} from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  fetchUsers,
  WORKFLOW_CARD_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
} from '@/lib/workflow'
import { useAuth } from '@/context/AuthContext'

export default function UsersPage() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()

  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    refetch: refetchUsers,
  } = useQuery<User[]>({
    queryKey: ['users', currentUser?.tenant_id],
    queryFn: () => fetchUsers(),
  })

  const {
    data: invites,
    isLoading: invitesLoading,
    isError: invitesError,
    refetch: refetchInvites,
  } = useQuery<InviteListItem[]>({
    queryKey: ['user-invites', currentUser?.tenant_id],
    queryFn: () =>
      api.get('/api/users/invites') as unknown as Promise<InviteListItem[]>,
  })

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<TenantMemberRole>('hr')

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<TenantMemberRole>('hr')
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (payload: UserCreate) =>
      api.post('/api/users', payload) as unknown as Promise<User>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      setEmail('')
      setFullName('')
      setPassword('')
      setRole('hr')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create user'),
  })

  const inviteMutation = useMutation({
    mutationFn: (payload: InviteCreate) =>
      api.post('/api/users/invites', payload) as unknown as Promise<InviteResponse>,
    onSuccess: (result) => {
      setLastInviteUrl(result.invite_url)
      queryClient.invalidateQueries({ queryKey: ['user-invites'] })
      if (result.email_sent) {
        toast.success(`Invite email sent to ${result.email}`)
      } else {
        toast.error(
          'Invite created, but email could not be sent. Copy the link below and share it manually.',
        )
      }
      setInviteEmail('')
      setInviteRole('hr')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invite'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) =>
      api.patch(`/api/users/${id}`, body) as unknown as Promise<User>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update user'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete user'),
  })

  const revokeInviteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/users/invites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-invites'] })
      toast.success('Invite revoked')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to revoke invite'),
  })

  function onDelete(user: User) {
    if (
      !window.confirm(
        `Delete ${user.full_name} (${user.email})? This cannot be undone.`,
      )
    ) {
      return
    }
    deleteMutation.mutate(user.id)
  }

  function onRevokeInvite(invite: InviteListItem) {
    if (!window.confirm(`Revoke invite for ${invite.email}?`)) return
    revokeInviteMutation.mutate(invite.id)
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Invite link copied')
    } catch {
      toast.error('Could not copy — select the link manually')
    }
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      email: email.trim(),
      full_name: fullName.trim(),
      password,
      role,
    })
  }

  function onInvite(e: FormEvent) {
    e.preventDefault()
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole })
  }

  async function copyInviteUrl() {
    if (!lastInviteUrl) return
    await copyUrl(lastInviteUrl)
  }

  const isLoading = usersLoading || invitesLoading
  const isError = usersError || invitesError

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  }

  if (isError || !users || !invites) {
    return (
      <BackendError
        onRetry={() => {
          void refetchUsers()
          void refetchInvites()
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Users</h2>
        <p className="mt-1 text-sm text-slate-500">
          Invite teammates or create Admin and HR accounts for your organization
          {currentUser?.tenant_name ? ` (${currentUser.tenant_name})` : ''}.
        </p>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Invite by email</h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Sends an invitation email with a link to join your organization.
        </p>
        <form onSubmit={onInvite} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="colleague@company.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TenantMemberRole)}
              className={WORKFLOW_INPUT_CLASS}
            >
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
            >
              {inviteMutation.isPending ? 'Sending invite…' : 'Send invite email'}
            </button>
          </div>
        </form>
        {lastInviteUrl && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-600">
              Backup invite link (share manually if email didn&apos;t arrive)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-slate-700">{lastInviteUrl}</code>
              <button
                type="button"
                onClick={copyInviteUrl}
                className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Create user</h3>
        </div>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="jane@company.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as TenantMemberRole)}
              className={WORKFLOW_INPUT_CLASS}
            >
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
            >
              {createMutation.isPending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4">
          <Users className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">All users</h3>
          <span className="text-xs text-slate-400">
            {users.length} member{users.length === 1 ? '' : 's'}
            {invites.length > 0
              ? ` · ${invites.length} invite${invites.length === 1 ? '' : 's'}`
              : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Role</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {invites.map((invite) => (
                <tr key={`invite-${invite.id}`} className="text-slate-700">
                  <td className="px-6 py-3 font-medium text-slate-400">—</td>
                  <td className="px-6 py-3">{invite.email}</td>
                  <td className="px-6 py-3 capitalize">{invite.role}</td>
                  <td className="px-6 py-3">
                    <span
                      className={
                        invite.status === 'pending'
                          ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700'
                          : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600'
                      }
                    >
                      {invite.status === 'pending' ? 'Invited' : 'Invite expired'}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {invite.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => void copyUrl(invite.invite_url)}
                          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          Copy link
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={revokeInviteMutation.isPending}
                        onClick={() => onRevokeInvite(invite)}
                        className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id
                return (
                  <tr key={u.id} className="text-slate-700">
                    <td className="px-6 py-3 font-medium text-slate-900">{u.full_name}</td>
                    <td className="px-6 py-3">{u.email}</td>
                    <td className="px-6 py-3 capitalize">{u.role}</td>
                    <td className="px-6 py-3">
                      <span
                        className={
                          u.is_active
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                            : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600'
                        }
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {isSelf ? (
                        <span className="text-xs text-slate-400">You</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={updateMutation.isPending || deleteMutation.isPending}
                            onClick={() =>
                              updateMutation.mutate({
                                id: u.id,
                                body: { is_active: !u.is_active },
                              })
                            }
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            disabled={updateMutation.isPending || deleteMutation.isPending}
                            onClick={() => onDelete(u)}
                            className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-400">
                    No users or invites yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
