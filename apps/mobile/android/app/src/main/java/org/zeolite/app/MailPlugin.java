package org.zeolite.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Opens the mail app (Gmail, Outlook…) with a new message: recipients,
 * subject, text and attached files (the note as PDF, its pictures). The
 * files are written to the app's cache and shared through its FileProvider;
 * the user checks the message and sends it from the mail app.
 */
@CapacitorPlugin(name = "Mail")
public class MailPlugin extends Plugin {

    @PluginMethod
    public void compose(PluginCall call) {
        String to = call.getString("to", "");
        String subject = call.getString("subject", "");
        String text = call.getString("text", "");
        JSArray files = call.getArray("files", new JSArray());

        ArrayList<Uri> uris = new ArrayList<>();
        File dir = new File(getContext().getCacheDir(), "mail");
        // Attachments of earlier messages are no longer needed.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            call.reject("Cannot prepare the attachments.");
            return;
        }
        try {
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String name = f.optString("name", "attachment").replaceAll("[\\\\/:*?\"<>|]", "-");
                File out = new File(dir, name);
                try (FileOutputStream s = new FileOutputStream(out)) {
                    s.write(Base64.decode(f.getString("data"), Base64.DEFAULT));
                }
                uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out));
            }
        } catch (JSONException | IOException | IllegalArgumentException e) {
            call.reject("Cannot prepare the attachments: " + e.getMessage());
            return;
        }

        Intent intent;
        if (uris.isEmpty()) {
            // No attachment: only mail apps answer a mailto: address.
            intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
        } else if (uris.size() == 1) {
            intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/pdf");
            intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            intent.setType("*/*");
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        }
        String[] recipients = to.trim().isEmpty() ? new String[0] : to.trim().split("\\s*[;,]\\s*");
        if (recipients.length > 0) intent.putExtra(Intent.EXTRA_EMAIL, recipients);
        intent.putExtra(Intent.EXTRA_SUBJECT, subject);
        intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            Intent chooser = Intent.createChooser(intent, "Send with");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve(new JSObject());
        } catch (ActivityNotFoundException e) {
            call.reject("No mail app found on this device.");
        }
    }
}
