import Capacitor
import UIKit

/// Custom Capacitor 8 bridge that registers local CAPBridgedPlugin instances.
/// Local plugins in the App target are not auto-discovered; they need registerPluginInstance.
class OrbitBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
