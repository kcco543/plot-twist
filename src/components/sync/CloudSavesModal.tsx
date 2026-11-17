"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useWorldName } from "@/components/worlds/worldNames";
import { useI18n, type MessageKey } from "@/i18n";
import { useWorldIndex, allWorlds, type WorldSave } from "@/lib/saves/worldSaves";
import { listBackups, type BackupSummary } from "@/lib/sync/backups";
import { addWorldsToAccount, resolveConflict, signIn, signOut, signUp, syncNow, useSyncStatus, type AuthResult } from "@/lib/sync/client";
import type { Conflict } from "@/lib/sync/engine";
import { closeCloudSaves, useCloudSavesOpen } from "./cloudSavesStore";
import { SyncBadge } from "./SyncBadge";
import { useTransferActions, type Notice } from "./transferActions";

/** Mounted once (root layout): the Cloud saves window, opened from any sync badge. */
export function CloudSavesHost() {
  const open = useCloudSavesOpen();
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={closeCloudSaves} title={t("sync.title")} closeLabel={t("common.close")} size="lg">
      {open && <CloudSavesBody />}
    </Modal>
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={notice ? `px-3 py-2 text-base leading-snug ${notice.error ? "bg-peach-hi shadow-[inset_4px_0_0_var(--color-peach-lo)]" : "bg-butter-hi shadow-[inset_4px_0_0_var(--color-butter-lo)]"}` : "sr-only"}
    >
      {notice?.text}
    </p>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="flex flex-col gap-3 border-t-[3px] border-dashed border-line pt-4" aria-labelledby={id}>
      <h3 id={id} className="font-head text-xl font-bold text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CloudSavesBody() {
  const { t, locale } = useI18n();
  const s = useSyncStatus();
  const [notice, setNotice] = useState<Notice | null>(null);
  const signedIn = Boolean(s.account) && s.phase !== "signed-out" && s.phase !== "unconfigured";

  const statusText: Record<string, MessageKey> = {
    saving: "sync.statusSaving",
    synced: "sync.statusSynced",
    offline: "sync.statusOffline",
    error: s.error === "auth" ? "sync.statusErrorAuth" : "sync.statusError",
    conflict: "sync.statusConflict",
  };

  return (
    <div className="flex flex-col gap-5 text-lg leading-snug">
      <p className="text-ink-soft">{t("sync.intro")}</p>
      <NoticeLine notice={notice} />

      {s.phase === "unconfigured" ? (
        <div className="flex items-start gap-2 bg-well px-3 py-2">
          <PixelIcon name="cloud" size={14} className="mt-1 text-ink-mute" />
          <div>
            <p className="font-bold">{t("sync.unconfiguredTitle")}</p>
            <p className="text-ink-soft">{t("sync.unconfiguredBody")}</p>
          </div>
        </div>
      ) : signedIn ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SyncBadge />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid="signed-in-as">
              {t("sync.signedInAs", { email: s.account!.email })}
            </span>
          </div>
          <p className="text-ink-soft" data-testid="sync-status-text">
            {statusText[s.phase] ? t(statusText[s.phase]) : null}
            {s.lastSyncedAt && s.phase === "synced" ? ` ${t("sync.statusSyncedAt", { time: new Date(s.lastSyncedAt).toLocaleTimeString(locale, { timeStyle: "short" }) })}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <PixelButton size="sm" variant="secondary" icon="cloud" onClick={() => void syncNow()} loading={s.phase === "saving"}>
              {s.phase === "error" ? t("sync.retry") : t("sync.syncNow")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="left" onClick={() => void signOut()}>
              {t("sync.signOut")}
            </PixelButton>
          </div>
        </div>
      ) : (
        <SignInForm />
      )}

      {s.hiddenWorlds > 0 && (
        <p className="flex items-start gap-2 text-base text-ink-soft">
          <PixelIcon name="lock" size={12} className="mt-1.5 shrink-0" />
          {t("sync.hiddenWorlds", { count: s.hiddenWorlds })}
        </p>
      )}

      {signedIn && s.conflicts.length > 0 && <Conflicts conflicts={s.conflicts} onNotice={setNotice} />}
      {signedIn && <DeviceWorlds onNotice={setNotice} />}
      <Transfer onNotice={setNotice} />
      <Backups onNotice={setNotice} accountId={signedIn ? s.account!.id : null} />
    </div>
  );
}

function SignInForm() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice | null>(null);

  const explain = (r: AuthResult): Notice => {
    if (r.ok) return { text: r.needsConfirmation ? t("sync.confirmEmail", { email }) : "" };
    const key: Record<string, MessageKey> = { invalid: "sync.authInvalid", exists: "sync.authExists", weak: "sync.authWeak", network: "sync.authNetwork", unconfirmed: "sync.authUnconfirmed", rate: "sync.authRate" };
    return { text: key[r.reason] ? t(key[r.reason]) : t("sync.authOther", { message: r.message ?? "" }), error: true };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "up" && password.length < 8) return setMsg({ text: t("sync.authWeak"), error: true });
    setBusy(true);
    setMsg(null);
    const r = mode === "in" ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    const n = explain(r);
    if (n.text) setMsg(n);
    if (r.ok && r.needsConfirmation) setMode("in");
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label={mode === "in" ? t("sync.signIn") : t("sync.signUp")}>
      <label className="flex flex-col gap-1">
        <span className="font-label text-xs uppercase tracking-wide text-label">{t("sync.email")}</span>
        <input className="px-input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label text-xs uppercase tracking-wide text-label">{t("sync.password")}</span>
        <input
          className="px-input"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          required
          minLength={mode === "up" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          name="password"
        />
        {mode === "up" && <span className="text-base text-ink-soft">{t("sync.passwordHint")}</span>}
      </label>
      <NoticeLine notice={msg} />
      <div className="flex flex-wrap items-center gap-3">
        <PixelButton type="submit" variant="primary" icon="cloud" loading={busy}>
          {busy ? t("sync.signingIn") : mode === "in" ? t("sync.signIn") : t("sync.signUp")}
        </PixelButton>
        <button type="button" className="px-focus text-base text-label underline underline-offset-4" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? t("sync.noAccount") : t("sync.haveAccount")}
        </button>
      </div>
    </form>
  );
}

function Conflicts({ conflicts, onNotice }: { conflicts: Conflict[]; onNotice: (n: Notice | null) => void }) {
  const { t } = useI18n();
  const nameOf = useWorldName();
  const [busy, setBusy] = useState<string | null>(null);
  const choose = async (c: Conflict, choice: "keep-both" | "use-local" | "use-cloud") => {
    setBusy(c.worldId);
    onNotice(null);
    await resolveConflict(c.worldId, choice);
    setBusy(null);
  };
  return (
    <Section title={t("sync.conflictsTitle")}>
      <ul className="flex flex-col gap-4">
        {conflicts.map((c) => {
          const w = allWorlds().find((x) => x.id === c.worldId);
          const name = w ? nameOf(w) : t("sync.unnamed");
          const deleted = c.kind === "deleted-elsewhere";
          return (
            <li key={c.worldId} className="flex flex-col gap-2 bg-pink-hi/50 px-3 py-3" data-testid="conflict">
              <p>{deleted ? t("sync.conflictDeleted", { name }) : t("sync.conflictBoth", { name, device: c.cloudDevice || t("sync.anotherDevice") })}</p>
              <div className="flex flex-wrap gap-2">
                {!deleted && (
                  <PixelButton size="sm" variant="primary" icon="layers" disabled={busy !== null} loading={busy === c.worldId} onClick={() => void choose(c, "keep-both")} title={t("sync.keepBothHint")}>
                    {t("sync.keepBoth")}
                  </PixelButton>
                )}
                <PixelButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void choose(c, "use-local")}>
                  {deleted ? t("sync.useLocalDeleted") : t("sync.useLocal")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => void choose(c, "use-cloud")}>
                  {deleted ? t("sync.useCloudDeleted") : t("sync.useCloud")}
                </PixelButton>
              </div>
              {!deleted && <p className="text-base text-ink-soft">{t("sync.keepBothHint")}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function DeviceWorlds({ onNotice }: { onNotice: (n: Notice | null) => void }) {
  const { t } = useI18n();
  const nameOf = useWorldName();
  useWorldIndex();
  const mine: WorldSave[] = allWorlds().filter((w) => !w.owner);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mine.map((w) => w.id)));
  const [busy, setBusy] = useState(false);
  const { exportWorlds } = useTransferActions();

  if (!mine.length) return null;
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const ids = mine.filter((w) => picked.has(w.id)).map((w) => w.id);

  const add = async () => {
    setBusy(true);
    onNotice(null);
    const n = await addWorldsToAccount(ids);
    setBusy(false);
    onNotice({ text: t("sync.deviceAdded", { count: n }) });
  };

  return (
    <Section title={t("sync.deviceTitle")} id="device-worlds">
      <p className="text-base text-ink-soft">{t("sync.deviceBody")}</p>
      <ul className="flex flex-col gap-1.5">
        {mine.map((w) => (
          <li key={w.id}>
            <label className="flex min-h-11 items-center gap-3 bg-well px-3 py-1.5">
              <input type="checkbox" className="size-5 accent-[var(--color-label)]" checked={picked.has(w.id)} onChange={() => toggle(w.id)} />
              <span className="min-w-0 flex-1 truncate font-bold">{nameOf(w)}</span>
              <span className="shrink-0 text-base text-ink-soft">{t(w.characterCount === 1 ? "myWorlds.character" : "myWorlds.characters", { count: w.characterCount })}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <PixelButton size="sm" variant="ghost" icon="down" disabled={!ids.length || busy} onClick={() => void exportWorlds(ids, "device-backup").then(onNotice)}>
          {t("sync.downloadBackupFirst")}
        </PixelButton>
        <PixelButton size="sm" variant="primary" icon="cloud" disabled={!ids.length} loading={busy} onClick={() => void add()} data-testid="add-to-account">
          {busy ? t("sync.deviceAdding") : t("sync.deviceAdd")}
        </PixelButton>
      </div>
    </Section>
  );
}

function Transfer({ onNotice }: { onNotice: (n: Notice | null) => void }) {
  const { t } = useI18n();
  const index = useWorldIndex();
  const { exportWorlds, importFile } = useTransferActions();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title={t("sync.transferTitle")}>
      <p className="text-base text-ink-soft">{t("sync.transferBody")}</p>
      <div className="flex flex-wrap gap-2">
        <PixelButton size="sm" variant="secondary" icon="down" disabled={!index.worlds.length} onClick={() => void exportWorlds(index.worlds.map((w) => w.id), "all-worlds").then(onNotice)}>
          {t("sync.exportAll")}
        </PixelButton>
        <PixelButton size="sm" variant="secondary" icon="upload" loading={busy} onClick={() => input.current?.click()}>
          {busy ? t("sync.importing") : t("sync.importSave")}
        </PixelButton>
        <input
          ref={input}
          type="file"
          accept=".json,.plottwist.json,application/json"
          className="sr-only"
          data-testid="import-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            onNotice(await importFile(f));
            setBusy(false);
          }}
        />
      </div>
    </Section>
  );
}

function Backups({ onNotice, accountId }: { onNotice: (n: Notice | null) => void; accountId: string | null }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState<BackupSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const { downloadBackup, restoreBackup } = useTransferActions();
  const index = useWorldIndex();

  useEffect(() => {
    let live = true;
    void listBackups(accountId).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [accountId, index]);

  const shown = more ? (list ?? []) : (list ?? []).slice(0, 5);
  return (
    <Section title={t("sync.backupsTitle")}>
      <p className="text-base text-ink-soft">{t("sync.backupsBody")}</p>
      {list && list.length === 0 && <p className="text-base text-ink-mute">{t("sync.backupsNone")}</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((b) => {
          const name = b.name || t("sync.unnamed");
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-2 bg-well px-3 py-2 text-base">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {t("sync.backupLine", {
                  name,
                  chars: b.characters,
                  when: new Date(b.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }),
                  reason: t(`sync.backupReason.${b.reason}` as MessageKey),
                })}
              </span>
              <PixelButton size="sm" variant="ghost" icon="down" onClick={() => void downloadBackup(b.id).then(onNotice)}>
                {t("sync.download")}
              </PixelButton>
              <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => void restoreBackup(b.id, name).then(onNotice)}>
                {t("sync.restoreCopy")}
              </PixelButton>
            </li>
          );
        })}
      </ul>
      {list && list.length > 5 && !more && (
        <PixelButton size="sm" variant="ghost" icon="down" onClick={() => setMore(true)}>
          +{list.length - 5}
        </PixelButton>
      )}
    </Section>
  );
}
