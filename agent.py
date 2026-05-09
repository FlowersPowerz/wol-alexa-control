import customtkinter as ctk
import threading
import requests
import json
import os
import uuid
import hashlib
from PIL import Image
import pystray
from pystray import MenuItem as item
import sys
import winreg
import pathlib
import time
import certifi

# Fix for PyInstaller CA bundle
if getattr(sys, 'frozen', False):
    cert_path = certifi.where()
    os.environ['REQUESTS_CA_BUNDLE'] = cert_path
    os.environ['SSL_CERT_FILE'] = cert_path

BASE_DIR = pathlib.Path(sys.argv[0]).parent.absolute()
SETTINGS_PATH = BASE_DIR / "agent_settings.json"

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

ICON_PATH = resource_path("icon.png")

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

class WolAgentApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.mac_address = ':'.join(['{:02x}'.format((uuid.getnode() >> ele) & 0xff) for ele in range(0,8*6,8)][::-1])
        self.app_name = "WOLCenterAgent"
        self.last_msg_id = None # Store last processed message ID
        
        self.title("WOL Center Agent")
        self.geometry("500x620")
        
        try:
            self.icon_image = Image.open(ICON_PATH)
            self.icon_photo = ctk.CTkImage(light_image=self.icon_image, dark_image=self.icon_image, size=(32, 32))
            self.wm_iconbitmap(resource_path("icon.ico"))
        except: pass

        self.resizable(False, False)
        self.protocol('WM_DELETE_WINDOW', self.withdraw_window)

        self.is_running = True
        self.listen_thread = None
        self.setup_ui()
        self.load_settings()

        if "--minimized" in sys.argv:
            self.withdraw_window()

    def setup_ui(self):
        self.header = ctk.CTkLabel(self, text="🛡️ WOL Secure Agent", font=ctk.CTkFont(size=24, weight="bold"))
        self.header.pack(pady=(30, 5))

        self.mac_frame = ctk.CTkFrame(self)
        self.mac_frame.pack(pady=10, padx=20, fill="x")
        self.label_mac = ctk.CTkLabel(self.mac_frame, text="PC MAC Address (Sync with Dashboard):")
        self.label_mac.pack(pady=(10, 0))
        self.mac_entry = ctk.CTkEntry(self.mac_frame, placeholder_text="AA:BB:CC:DD:EE:FF")
        self.mac_entry.insert(0, self.mac_address)
        self.mac_entry.pack(pady=10, padx=20, fill="x")

        self.key_frame = ctk.CTkFrame(self)
        self.key_frame.pack(pady=10, padx=20, fill="x")
        self.label_key = ctk.CTkLabel(self.key_frame, text="Security Key (Vercel Admin Password):")
        self.label_key.pack(pady=(10, 0))
        self.key_entry = ctk.CTkEntry(self.key_frame, show="*", placeholder_text="Enter secret key")
        self.key_entry.pack(pady=10, padx=20, fill="x")

        self.action_frame = ctk.CTkFrame(self)
        self.action_frame.pack(pady=10, padx=20, fill="x")
        self.action_label = ctk.CTkLabel(self.action_frame, text="Default Action for 'Turn Off':")
        self.action_label.pack(side="left", padx=20, pady=15)
        self.action_var = ctk.StringVar(value="Sleep")
        self.action_menu = ctk.CTkOptionMenu(self.action_frame, values=["Sleep", "Shutdown", "Hibernate"], variable=self.action_var, width=120)
        self.action_menu.pack(side="right", padx=20)

        self.startup_var = ctk.BooleanVar(value=False)
        self.startup_check = ctk.CTkCheckBox(self, text="Launch at Windows Startup", variable=self.startup_var, command=self.toggle_startup)
        self.startup_check.pack(pady=10)

        self.connect_btn = ctk.CTkButton(self, text="🚀 Connect & Save", command=self.restart_listener, font=ctk.CTkFont(weight="bold"), height=40)
        self.connect_btn.pack(pady=15)

        self.status_label = ctk.CTkLabel(self, text="🔴 Offline", text_color="#ff4d4d", font=ctk.CTkFont(weight="bold"))
        self.status_label.pack()

        self.log_box = ctk.CTkTextbox(self, height=80, width=440)
        self.log_box.pack(pady=15, padx=20)
        self.log_box.configure(state="disabled")

        self.footer = ctk.CTkLabel(self, text="Built by FlowersPowerz", font=ctk.CTkFont(size=10), text_color="gray")
        self.footer.pack(side="bottom", pady=10)

    def add_log(self, text):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"> {text}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def toggle_startup(self, silent=False):
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
            if self.startup_var.get():
                app_path = os.path.realpath(sys.argv[0])
                winreg.SetValueEx(key, self.app_name, 0, winreg.REG_SZ, f'"{app_path}" --minimized')
                if not silent: self.add_log("Startup enabled.")
            else:
                try:
                    winreg.DeleteValue(key, self.app_name)
                    if not silent: self.add_log("Startup disabled.")
                except FileNotFoundError: pass
            winreg.CloseKey(key)
        except Exception as e:
            if not silent: self.add_log(f"Registry Error: {e}")

    def execute_action(self, action):
        action = action.lower()
        if "sleep" in action:
            self.after(0, lambda: self.add_log("System Sleep triggered..."))
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        elif "shutdown" in action:
            self.after(0, lambda: self.add_log("System Shutdown triggered..."))
            os.system("shutdown /s /f /t 0")
        elif "hibernate" in action:
            self.after(0, lambda: self.add_log("System Hibernation triggered..."))
            os.system("shutdown /h")

    def safe_update_status(self, text, color):
        self.after(0, lambda: self.status_label.configure(text=text, text_color=color))

    def start_listening(self, key, raw_mac, default_action):
        if not key or not raw_mac:
            self.safe_update_status("🔴 Setup Incomplete", "#ff4d4d")
            return

        clean_mac = raw_mac.strip().replace(':', '').replace('-', '').replace(' ', '').lower()
        clean_key = key.strip()
        secret_hash = hashlib.sha256((clean_mac + clean_key).encode()).hexdigest()[:20]
        topic = f"wol_{secret_hash}"
        url = f"https://ntfy.sh/{topic}/json"
        
        while self.is_running:
            try:
                session = requests.Session()
                adapter = requests.adapters.HTTPAdapter(max_retries=requests.adapters.Retry(total=3, backoff_factor=1))
                session.mount("https://", adapter)
                
                self.safe_update_status("🟢 Secure Listening Active", "#00ff88")
                
                with session.get(url, stream=True, timeout=45) as r:
                    for line in r.iter_lines():
                        if not self.is_running: break
                        if line:
                            data = json.loads(line)
                            if data.get("event") == "message":
                                msg_id = data.get("id")
                                if data.get("message", "").lower() == "off":
                                    # Dedup: only process if it's a new message ID
                                    if msg_id and msg_id != self.last_msg_id:
                                        self.last_msg_id = msg_id
                                        current_action = self.action_var.get()
                                        self.after(0, lambda: self.add_log(f"Command 'OFF' received! Action: {current_action}"))
                                        self.execute_action(current_action)
            except Exception as e:
                if not self.is_running: break
                self.safe_update_status("🟡 Connection Lost - Retrying...", "#ffff00")
                err_msg = str(e)[:50]
                # self.after(0, lambda: self.add_log(f"Connection issue: {err_msg}..."))
                time.sleep(5) 
                continue

    def restart_listener(self):
        self.is_running = False
        self.save_settings()
        
        key = self.key_entry.get()
        mac = self.mac_entry.get()
        action = self.action_var.get()
        
        self.is_running = True
        self.listen_thread = threading.Thread(
            target=self.start_listening, 
            args=(key, mac, action), 
            daemon=True
        )
        self.listen_thread.start()

    def save_settings(self):
        settings = {
            "key": self.key_entry.get(), 
            "mac": self.mac_entry.get(), 
            "action": self.action_var.get(),
            "startup": self.startup_var.get()
        }
        with open(SETTINGS_PATH, "w") as f:
            json.dump(settings, f)

    def load_settings(self):
        if SETTINGS_PATH.exists():
            try:
                with open(SETTINGS_PATH, "r") as f:
                    data = json.load(f)
                    self.mac_entry.delete(0, "end")
                    self.mac_entry.insert(0, data.get("mac", self.mac_address))
                    self.key_entry.insert(0, data.get("key", ""))
                    self.action_var.set(data.get("action", "Sleep"))
                    self.startup_var.set(data.get("startup", False))
                    
                    if data.get("startup", False):
                        self.after(1000, lambda: self.toggle_startup(silent=True))
                        
                    if data.get("key"): self.restart_listener()
            except: pass

    def withdraw_window(self):
        self.withdraw()
        try:
            image = Image.open(ICON_PATH)
        except:
            image = Image.new('RGB', (64, 64), color=(0, 242, 255))
            
        self.tray_icon = pystray.Icon("WOLAgent", image, "WOL Agent", (
            item('Show', self.show_window, default=True), 
            item('Exit', self.exit_app)
        ))
        self.tray_icon.run_detached()

    def show_window(self):
        if hasattr(self, 'tray_icon'): self.tray_icon.stop()
        self.after(0, self.deiconify)

    def exit_app(self):
        self.is_running = False
        if hasattr(self, 'tray_icon'): 
            self.tray_icon.stop()
        self.after(0, self._final_exit)

    def _final_exit(self):
        self.destroy()
        os._exit(0)

if __name__ == "__main__":
    app = WolAgentApp()
    app.mainloop()
