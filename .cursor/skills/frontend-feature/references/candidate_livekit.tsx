/**
 * Reference: Candidate-app-only pattern — LiveKit video/audio. The two things
 * to get right: (1) connect/disconnect tied to mount/unmount so rooms don't
 * leak, and (2) permission-denied and connection-failure handled as
 * first-class states, because they're the common case in real interviews.
 *
 * Packages: livekit-client, @livekit/components-react, @livekit/components-styles
 */

// ---------------------------------------------------------------------------
// Fetch the LiveKit access token from the backend (typed, via React Query).
// Never hardcode tokens; the backend mints them.
// ---------------------------------------------------------------------------
// src/features/interview/queries.ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface LiveKitGrant {
  token: string;
  serverUrl: string;
}

export function useLiveKitGrant(roomId: string) {
  return useQuery({
    queryKey: ['livekit-grant', roomId],
    queryFn: async (): Promise<LiveKitGrant> => {
      const { data } = await apiClient.get<LiveKitGrant>(
        `/interview/${roomId}/token`,
      );
      return data;
    },
    enabled: Boolean(roomId),
    staleTime: Infinity, // token is per-session; don't refetch in the background
  });
}

// ---------------------------------------------------------------------------
// Room component — LiveKitRoom manages the connection lifecycle for us; we
// wrap it with our own loading / error / permission handling.
// ---------------------------------------------------------------------------
// src/features/interview/components/InterviewRoom.tsx
import { useState } from 'react';
import {
  LiveKitRoom,
  VideoConference,
} from '@livekit/components-react';
import '@livekit/components-styles';
import toast from 'react-hot-toast';

import { useLiveKitGrant } from '../queries';

export function InterviewRoom({ roomId }: { roomId: string }) {
  const { data: grant, isPending, isError } = useLiveKitGrant(roomId);
  const [connectionFailed, setConnectionFailed] = useState(false);

  if (isPending) {
    return <div className="text-slate-300">Preparing your interview room…</div>;
  }

  if (isError || !grant) {
    return (
      <div className="text-red-400">
        Couldn&apos;t start the session. Refresh to try again.
      </div>
    );
  }

  // connection-failure is first-class, not an afterthought
  if (connectionFailed) {
    return (
      <div className="space-y-3 text-slate-200">
        <p>Lost connection to the interview room.</p>
        <button
          onClick={() => setConnectionFailed(false)}
          className="rounded-md bg-slate-700 px-3 py-2 text-sm"
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={grant.token}
      serverUrl={grant.serverUrl}
      connect                          // connect on mount
      video
      audio
      onError={(err) => {
        // permission-denied (camera/mic) lands here too — surface it clearly
        toast.error(
          err.name === 'NotAllowedError'
            ? 'Camera/microphone access is required to join.'
            : 'Connection error. Check your network.',
        );
        setConnectionFailed(true);
      }}
      onDisconnected={() => {
        // component unmount disconnects automatically; this fires on drops too
        setConnectionFailed(true);
      }}
      data-lk-theme="default"
      className="h-full bg-slate-900"
    >
      <VideoConference />
    </LiveKitRoom>
  );
}

/**
 * Notes:
 *  - LiveKitRoom disconnects on unmount, so leaving the route cleans up the
 *    room — don't also tear it down manually or you'll double-disconnect.
 *  - Ask for camera/mic permission gracefully; NotAllowedError is a UX state,
 *    not a crash.
 *  - Dark slate theme: keep the room chrome consistent with the candidate app.
 */
