import tkinter as tk
import subprocess
import webbrowser
import os
import time
import socket
import serial

# Path to your venv's python.exe
# VENV_PYTHON = r"D:\Projects\venv\Scripts\python.exe"


node_proc = None
python_proc = None

# URL to open
WEB_URL = "http://192.168.2.190:3000"

# Tkinter setup
root = tk.Tk()
root.title("Casino Wars Server Control")
root.geometry("350x220")

status_node = tk.StringVar()
status_python = tk.StringVar()
status_node.set("Node App: Not running")
status_python.set("Python Server: Not running")

SERIAL_PORT = "COM1"  # Match with server.py
BAUD_RATE = 9600

def start_servers():
    global node_proc, python_proc
    if node_proc is None or node_proc.poll() is not None:
        node_proc = subprocess.Popen(
            "npx next dev --port 3000 --hostname 0.0.0.0",
            cwd=os.getcwd(),
            shell=True
        )
        status_node.set("Node App: Running")
    else:
        status_node.set("Node App: Already running")
    if python_proc is None or python_proc.poll() is not None:
        python_proc = subprocess.Popen(
            # f'"{VENV_PYTHON}" server.py',
            "python casino_war_backend.py",
            cwd=os.getcwd(),
            shell=True
        )
        status_python.set("Python Server: Running")
    else:
        status_python.set("Python Server: Already running")


def open_web():
    webbrowser.open(WEB_URL)

def is_port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('0.0.0.0', port)) == 0 or s.connect_ex(('127.0.0.1', port)) == 0

def close_serial_port():
    """Close the serial port if it's in use."""
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        if ser.is_open:
            ser.close()
            print(f"Closed {SERIAL_PORT} successfully.")
    except serial.SerialException as e:
        print(f"Could not close {SERIAL_PORT}: {e}")

def close_servers():
    global node_proc, python_proc
    if node_proc is not None and node_proc.poll() is None:
        node_proc.terminate()
        try:
            node_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            node_proc.kill()
        time.sleep(1)  # Give OS a moment to release the port
        if is_port_open(3000):
            status_node.set("Node App: Port still in use!")
        else:
            status_node.set("Node App: Stopped")
    else:
        status_node.set("Node App: Not running")
    if python_proc is not None and python_proc.poll() is None:
        python_proc.terminate()
        try:
            python_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            python_proc.kill()
        status_python.set("Python Server: Stopped")
    else:
        status_python.set("Python Server: Not running")
    # Close serial port as well
    close_serial_port()

def on_close():
    close_servers()
    root.destroy()

# Buttons
btn_start = tk.Button(root, text="Start Servers", command=start_servers, width=20)
btn_start.pack(pady=10)

btn_open = tk.Button(root, text="Open Web App", command=open_web, width=20)
btn_open.pack(pady=10)

btn_close = tk.Button(root, text="Close Servers", command=close_servers, width=20)
btn_close.pack(pady=10)

# Status labels
label_node = tk.Label(root, textvariable=status_node, fg="green")
label_node.pack(pady=2)
label_python = tk.Label(root, textvariable=status_python, fg="blue")
label_python.pack(pady=2)

root.protocol("WM_DELETE_WINDOW", on_close)
root.mainloop()
