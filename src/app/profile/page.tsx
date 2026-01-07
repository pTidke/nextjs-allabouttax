import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { User, Mail, Shield } from "lucide-react";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-slate-900 mb-8">
            Your Profile
          </h1>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="h-32 bg-gradient-to-r from-emerald-500 to-teal-600" />

            <div className="px-8 pb-8">
              <div className="relative flex justify-between items-end -mt-12 mb-6">
                <div className="h-24 w-24 rounded-2xl border-4 border-white overflow-hidden bg-emerald-100 shadow-sm">
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || ""}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-emerald-700">
                      {session.user.name?.[0]?.toUpperCase() || "U"}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pb-2">
                  <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">
                    {session.user.role}
                  </span>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {session.user.name}
                  </h2>
                  <p className="text-slate-500">
                    Member since {new Date().toLocaleDateString()}
                  </p>
                </div>

                <div className="grid gap-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-3 text-slate-600">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <User size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Full Name
                      </p>
                      <p className="font-medium text-slate-900">
                        {session.user.name}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-slate-600">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Email Address
                      </p>
                      <p className="font-medium text-slate-900">
                        {session.user.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-slate-600">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <Shield size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Account Role
                      </p>
                      <p className="font-medium text-slate-900 lowercase capitalize">
                        {session.user.role}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
