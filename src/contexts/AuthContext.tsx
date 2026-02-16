import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  user: any | null;
  session: any | null;
  profile: any | null;
  organizationId: string | null;
  hasPendingRequest: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string, opts?: { first_name?: string; last_name?: string; name?: string }) => Promise<any>;
  signOut: () => Promise<void>;
  refetchOrganization: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      setProfile(data ?? null);
    } catch (err) {
      console.error("Error fetching profile:", err);
      setProfile(null);
    }
  };

  const fetchOrganization = async (userId?: string) => {
    const uid = userId || user?.id;
    if (!uid) return;
    try {
      const { data } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", uid)
        .maybeSingle();
      setOrganizationId(data?.organization_id ?? null);

      // If no org, check for pending join request
      if (!data?.organization_id) {
        const { data: pending } = await supabase
          .from("join_requests")
          .select("id")
          .eq("user_id", uid)
          .eq("status", "pending")
          .limit(1)
          .maybeSingle();
        setHasPendingRequest(!!pending);
      } else {
        setHasPendingRequest(false);
      }
    } catch (err) {
      console.error("Error fetching organization:", err);
      setOrganizationId(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        if (!mounted) return;

        // Skip INITIAL_SESSION — handled by getSession below
        if (event === "INITIAL_SESSION") return;

        // Token refresh or re-auth of the same user (e.g. returning to tab) — update session silently
        if (event === "TOKEN_REFRESHED" || (event === "SIGNED_IN" && sess?.user?.id === userIdRef.current)) {
          setSession(sess);
          return;
        }

        // Real auth change: different user signed in, or signed out
        setSession(sess);
        setUser(sess?.user ?? null);
        userIdRef.current = sess?.user?.id ?? null;

        if (sess?.user?.id) {
          setLoading(true);
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(async () => {
            if (mounted) {
              await Promise.all([
                fetchProfile(sess.user.id),
                fetchOrganization(sess.user.id),
              ]);
              if (mounted) setLoading(false);
            }
          }, 0);
        } else {
          setProfile(null);
          setOrganizationId(null);
          setHasPendingRequest(false);
          setLoading(false);
        }
      }
    );

    // Initial session check — this is the primary load path
    supabase.auth.getSession().then(async ({ data: { session: sess } }) => {
      if (!mounted) return;

      setSession(sess);
      setUser(sess?.user ?? null);
      userIdRef.current = sess?.user?.id ?? null;

      if (sess?.user?.id) {
        await Promise.all([
          fetchProfile(sess.user.id),
          fetchOrganization(sess.user.id),
        ]);
      }

      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signUp = async (
    email: string,
    password: string,
    opts?: { first_name?: string; last_name?: string; name?: string }
  ) => {
    const result = await supabase.auth.signUp({ email, password });

    const userId = result.data?.user?.id;
    if (userId) {
      await supabase.from("users").upsert({
        id: userId,
        email,
        first_name: opts?.first_name ?? null,
        last_name: opts?.last_name ?? null,
        name: opts?.name ?? (`${opts?.first_name ?? ""} ${opts?.last_name ?? ""}`.trim() || null),
      });

      await fetchProfile(userId);
    }

    return result;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    userIdRef.current = null;
    setProfile(null);
    setOrganizationId(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, organizationId, hasPendingRequest, loading, signIn, signUp, signOut, refetchOrganization: () => fetchOrganization() }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};