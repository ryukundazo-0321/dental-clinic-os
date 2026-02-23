import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();
    const { action } = body;

    // ===== APPROVE =====
    if (action === "approve") {
      const { appointment_id, field_key, staff_id, edited_text } = body;
      if (!appointment_id || !field_key) return NextResponse.json({ error: "Missing params" }, { status: 400 });

      const updateData: Record<string, unknown> = {
        status: "approved",
        approved_by: staff_id || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (edited_text !== undefined) {
        updateData.draft_text = edited_text;
      }

      const { error } = await supabase
        .from("karte_ai_drafts")
        .update(updateData)
        .eq("appointment_id", appointment_id)
        .eq("field_key", field_key);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // ===== CONFIRM =====
    if (action === "confirm") {
      const { appointment_id, staff_id } = body;
      if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

      // Check all fields are approved
      const { data: drafts } = await supabase
        .from("karte_ai_drafts")
        .select("*")
        .eq("appointment_id", appointment_id);

      const fields = ["s", "tooth", "perio", "dh", "dr"];
      const allApproved = fields.every(f => drafts?.find((d: { field_key: string; status: string }) => d.field_key === f && d.status === "approved"));

      if (!allApproved) {
        return NextResponse.json({ error: "Not all fields approved" }, { status: 400 });
      }

      // Build snapshot
      const snapshot: Record<string, string> = {};
      drafts?.forEach((d: { field_key: string; draft_text: string }) => { snapshot[d.field_key] = d.draft_text; });

      // Insert confirmation
      const { data: conf, error: confError } = await supabase
        .from("karte_confirmations")
        .insert({
          appointment_id,
          confirmed_by: staff_id || null,
          snapshot_json: snapshot,
        })
        .select()
        .single();

      if (confError) return NextResponse.json({ error: confError.message }, { status: 500 });

      // Update draft statuses to confirmed
      await supabase
        .from("karte_ai_drafts")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("appointment_id", appointment_id);

      // Write back to medical_records
      const soapS = snapshot.s || null;
      const soapO = [snapshot.tooth, snapshot.perio, snapshot.dh].filter(Boolean).join("\n\n") || null;
      const soapA = snapshot.dr?.match(/【A】[\s\S]*?(?=【P】|$)/)?.[0]?.replace("【A】", "").trim() || null;
      const soapP = snapshot.dr?.match(/【P】[\s\S]*/)?.[0]?.replace("【P】", "").trim() || null;

      const { error: mrError } = await supabase
        .from("medical_records")
        .update({
          soap_s: soapS,
          soap_o: soapO,
          soap_a: soapA,
          soap_p: soapP,
          status: "confirmed",
          doctor_confirmed: true,
        })
        .eq("appointment_id", appointment_id);

      if (mrError) console.error("medical_records update error:", mrError);

      // Update appointment status
      await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", appointment_id);

      return NextResponse.json({ success: true, confirmation_id: conf.id });
    }

    // ===== REVOKE =====
    if (action === "revoke") {
      const { confirmation_id, reason } = body;
      if (!confirmation_id) return NextResponse.json({ error: "Missing confirmation_id" }, { status: 400 });

      // Get the confirmation to find appointment_id
      const { data: conf } = await supabase
        .from("karte_confirmations")
        .select("appointment_id")
        .eq("id", confirmation_id)
        .single();

      if (!conf) return NextResponse.json({ error: "Confirmation not found" }, { status: 404 });

      // Mark as revoked
      await supabase
        .from("karte_confirmations")
        .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: reason || null })
        .eq("id", confirmation_id);

      // Revert drafts to approved
      await supabase
        .from("karte_ai_drafts")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("appointment_id", conf.appointment_id)
        .eq("status", "confirmed");

      // Revert medical_records
      await supabase
        .from("medical_records")
        .update({ status: "in_progress", doctor_confirmed: false })
        .eq("appointment_id", conf.appointment_id);

      // Revert appointment
      await supabase
        .from("appointments")
        .update({ status: "in_consultation" })
        .eq("id", conf.appointment_id);

      return NextResponse.json({ success: true });
    }

    // ===== MESSAGE =====
    if (action === "message") {
      const { appointment_id, direction, related_field, message_text, sender_id } = body;
      if (!appointment_id || !message_text || !direction) {
        return NextResponse.json({ error: "Missing params" }, { status: 400 });
      }

      const { data: msg, error } = await supabase
        .from("karte_messages")
        .insert({
          appointment_id,
          direction,
          related_field: related_field || null,
          message_text,
          sender_id: sender_id || null,
        })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message_id: msg.id });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("Karte agent action error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
