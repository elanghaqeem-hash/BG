"use client";
import { useEffect, useState, type FormEvent } from "react";
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Work = (fn: () => Promise<void>) => Promise<void>;
type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  org: string;
  office: string;
  active: boolean;
};
export function UsersPanel({
  api,
  work,
  busy,
}: {
  api: Api;
  work: Work;
  busy: boolean;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const load = async () => setUsers(await api("/users"));
  useEffect(() => {
    void work(load);
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      body = Object.fromEntries(new FormData(form));
    await work(async () => {
      await api("/users", "POST", body);
      form.reset();
      await load();
    });
  }
  return (
    <section className="card">
      <span className="eyebrow">ADMINISTRASI IDENTITAS</span>
      <h1>Pengguna dan akses</h1>
      <p>
        Akun menggunakan sesi server dan kewenangan yang diperiksa pada setiap
        transaksi. Penonaktifan mencabut seluruh sesi pengguna.
      </p>
      <form onSubmit={create}>
        <div className="form-grid">
          <label>
            Username baru
            <input
              name="username"
              required
              maxLength={120}
              autoComplete="off"
            />
          </label>
          <label>
            Nama pengguna
            <input name="name" required maxLength={200} />
          </label>
          <label>
            Password awal
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
            />
          </label>
          <label>
            Peran pengguna
            <select name="role">
              {[
                "PRINCIPAL",
                "AO",
                "ANALYST",
                "COMPLIANCE",
                "MPO",
                "MPO_KPO",
                "SUPPORT",
                "GH_BISNIS",
                "DIREKSI",
                "FINANCE",
                "PENJAMIN",
                "OBLIGEE",
                "BROKER",
                "LITIGATION",
                "LEGAL",
                "AUDIT",
                "ADMIN",
                "CONFIG_CHECKER",
                "WORKER",
              ].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label>
            Organisasi
            <input
              name="org"
              required
              placeholder="principal-1 / bank-org / partner-1"
            />
          </label>
          <label>
            Kantor
            <input name="office" placeholder="cabang-1 / kpo-1" />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          Daftarkan pengguna
        </button>
      </form>
      <h2>Daftar pengguna</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Nama dan organisasi</th>
              <th>Peran</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  {u.name}
                  <small>
                    {u.org} · {u.office || "—"}
                  </small>
                </td>
                <td>{u.role}</td>
                <td>{u.active ? "Aktif" : "Nonaktif"}</td>
                <td>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      work(async () => {
                        await api("/users/" + u.id + "/status", "POST", {
                          active: !u.active,
                        });
                        await load();
                      })
                    }
                  >
                    {u.active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function SecurityPanel({
  api,
  work,
  busy,
  onChanged,
}: {
  api: Api;
  work: Work;
  busy: boolean;
  onChanged: () => void;
}) {
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await work(async () => {
      await api("/auth/password", "POST", body);
      onChanged();
    });
  }
  return (
    <section className="card">
      <span className="eyebrow">KEAMANAN AKUN</span>
      <h1>Ubah password</h1>
      <p>
        Gunakan password yang unik, minimal 12 karakter. Perubahan password
        mencabut seluruh sesi dan meminta login kembali.
      </p>
      <form onSubmit={change}>
        <div className="form-grid">
          <label>
            Password saat ini
            <input
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={256}
            />
          </label>
          <label>
            Password baru
            <input
              name="new_password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
            />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          Simpan password baru
        </button>
      </form>
    </section>
  );
}
